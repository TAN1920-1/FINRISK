# FastAPI main application
# Replaces Electron IPC handlers with REST API endpoints
# Security: Argon2 password hashing, master password verification

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
import json

from database import (
    get_db, is_locked, needs_password, unlock_db, change_password,
    init_db
)
import risk_calculator as calc
import osint_service

app = FastAPI(title="TILT Dashboard API", version="1.0.0")

# CORS - allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "https://finrisk-beta.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class LoginRequest(BaseModel):
    password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class VendorCreate(BaseModel):
    name: str
    status: str
    data_classification: Optional[int] = None  # Tier level 1-5 (determines IMPACT)
    impact: Optional[float] = 3.0
    likelihood: Optional[float] = 3.0
    vulnerability: Optional[int] = 100
    weakness: Optional[str] = None
    strength: Optional[str] = None
    assessment_type: Optional[str] = None
    answers: Optional[Dict[int, int]] = None
    cloudScores: Optional[Dict[int, int]] = None  # Maturity scores 0-5 per criterion
    osint_warnings: Optional[List[Dict]] = None
    osint_urls: Optional[Dict[str, str]] = None
    osint_acknowledged: Optional[bool] = False

class VendorUpdate(VendorCreate):
    id: int

class AssessmentCalculate(BaseModel):
    assessment_type: str
    answers: Optional[Dict[int, int]] = None
    cloudScores: Optional[Dict[int, int]] = None  # Maturity scores 0-5 per criterion
    questions: Optional[List[Dict]] = None
    criteria: Optional[List[Dict]] = None
    osintResults: Optional[Dict] = None

class SettingsUpdate(BaseModel):
    orgName: Optional[str] = None

# Dependency: verify master password
def verify_master_password(password: str = Depends(lambda: None)):
    """Dependency to verify master password for sensitive routes."""
    # This is a placeholder - in real implementation, we'd check session/auth token
    # For now, we'll check on each request
    # TO FIX: Implement proper session management
    return True

# Helper to get database with proper error handling
def require_db():
    """Get database connection, raising HTTPException if locked."""
    try:
        return get_db()
    except Exception as e:
        raise HTTPException(status_code=403, detail=str(e))

# Auth endpoints
@app.post("/login")
async def login(req: LoginRequest):
    """Unlock database with master password."""
    try:
        result = unlock_db(req.password)
        return result
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/is-locked")
async def get_lock_status():
    """Check if database is locked."""
    return {
        'is_locked': is_locked(),
        'needs_password': needs_password(),
    }

@app.post("/change-password")
async def change_master_password(req: ChangePasswordRequest):
    """Change master password."""
    try:
        result = change_password(req.old_password, req.new_password)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Vendor endpoints
@app.get("/vendors")
async def get_vendors():
    """Get all vendors."""
    db = require_db()
    rows = db.execute('SELECT * FROM vendors ORDER BY updated_at DESC').fetchall()
    
    vendors = []
    for row in rows:
        vendor = dict(row)
        # Parse JSON fields
        vendor['answers'] = json.loads(vendor['answers']) if vendor.get('answers') else {}
        vendor['cloudScores'] = json.loads(vendor['cloudScores']) if vendor.get('cloudScores') else {}
        vendor['osint_warnings'] = json.loads(vendor['osint_warnings']) if vendor.get('osint_warnings') else []
        vendor['osint_urls'] = json.loads(vendor['osint_urls']) if vendor.get('osint_urls') else {}
        
        # Extract OSINT results from warnings
        osint_results = None
        if vendor['osint_warnings']:
            ransomware_warn = next((w for w in vendor['osint_warnings'] if w.get('type') == 'ransomware'), None)
            ssl_warn = next((w for w in vendor['osint_warnings'] if w.get('type') == 'ssl'), None)
            dmarc_warn = next((w for w in vendor['osint_warnings'] if w.get('type') == 'dmarc'), None)
            
            if ransomware_warn or ssl_warn or dmarc_warn:
                ssl_grade = None
                if ssl_warn:
                    msg = ssl_warn.get('message', '')
                    if 'expired' in msg.lower():
                        ssl_grade = 'F'
                    elif ssl_warn.get('severity') == 'High':
                        ssl_grade = 'C'
                    else:
                        ssl_grade = 'B'
                
                osint_results = {
                    'ransomware': ransomware_warn is not None,
                    'ssl': ssl_grade,
                    'dmarc': dmarc_warn is None,  # If warning exists, DMARC is missing
                }
        
        vendor['osintResults'] = osint_results
        # Convert osint_acknowledged from integer (0/1) to boolean
        vendor['osint_acknowledged'] = bool(vendor.get('osint_acknowledged', 0))
        vendors.append(vendor)
    
    return vendors

@app.post("/vendors")
async def create_vendor(vendor: VendorCreate):
    """Create new vendor."""
    db = require_db()
    
    # Serialize JSON fields
    answers_json = json.dumps(vendor.answers or {})
    cloud_scores_json = json.dumps(vendor.cloudScores or {})
    warnings_json = json.dumps(vendor.osint_warnings or [])
    urls_json = json.dumps(vendor.osint_urls or {})
    
    cursor = db.execute('''
        INSERT INTO vendors (name, status, data_classification, impact, likelihood, vulnerability, 
                           weakness, strength, assessment_type, answers, cloudScores,
                           osint_warnings, osint_urls, osint_acknowledged)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        vendor.name, vendor.status, vendor.data_classification, vendor.impact, vendor.likelihood,
        vendor.vulnerability, vendor.weakness, vendor.strength,
        vendor.assessment_type, answers_json, cloud_scores_json, warnings_json, urls_json,
        1 if vendor.osint_acknowledged else 0
    ))
    
    db.commit()
    return {'success': True, 'id': cursor.lastrowid}

@app.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: int, vendor: VendorCreate):
    """Update existing vendor."""
    db = require_db()
    
    # Serialize JSON fields
    answers_json = json.dumps(vendor.answers or {})
    cloud_scores_json = json.dumps(vendor.cloudScores or {})
    warnings_json = json.dumps(vendor.osint_warnings or [])
    urls_json = json.dumps(vendor.osint_urls or {})
    
    db.execute('''
        UPDATE vendors 
        SET name = ?, status = ?, data_classification = ?, impact = ?, likelihood = ?, vulnerability = ?,
            weakness = ?, strength = ?, assessment_type = ?, answers = ?, cloudScores = ?,
            osint_warnings = ?, osint_urls = ?, osint_acknowledged = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    ''', (
        vendor.name, vendor.status, vendor.data_classification, vendor.impact, vendor.likelihood,
        vendor.vulnerability, vendor.weakness, vendor.strength,
        vendor.assessment_type, answers_json, cloud_scores_json, warnings_json, urls_json,
        1 if vendor.osint_acknowledged else 0, vendor_id
    ))
    
    db.commit()
    return {'success': True, 'id': vendor_id}

@app.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: int):
    """Delete vendor."""
    db = require_db()
    db.execute('DELETE FROM vendors WHERE id = ?', (vendor_id,))
    db.commit()
    return {'success': True}

# Question endpoints
@app.get("/questions/standard")
async def get_questions():
    """Get all standard assessment questions."""
    db = require_db()
    rows = db.execute('SELECT * FROM questions ORDER BY id').fetchall()
    
    questions = []
    for row in rows:
        q = dict(row)
        q['maturity_levels'] = json.loads(q['maturity_levels']) if q.get('maturity_levels') else {}
        questions.append(q)
    
    return questions

@app.post("/questions/standard")
async def save_question(question: Dict):
    """Save question (create or update)."""
    db = require_db()
    maturity_json = json.dumps(question.get('maturity_levels', {}))
    
    if question.get('id'):
        db.execute('''
            UPDATE questions 
            SET nist_control = ?, category = ?, policy_ref = ?, question = ?,
                weight = ?, maturity_levels = ?, notes = ?
            WHERE id = ?
        ''', (
            question.get('nist_control'), question.get('category'),
            question.get('policy_ref'), question['question'],
            question.get('weight'), maturity_json, question.get('notes'), question['id']
        ))
        db.commit()
        return {'success': True, 'id': question['id']}
    else:
        cursor = db.execute('''
            INSERT INTO questions (nist_control, category, policy_ref, question, weight, maturity_levels, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            question.get('nist_control'), question.get('category'),
            question.get('policy_ref'), question['question'],
            question.get('weight'), maturity_json, question.get('notes')
        ))
        db.commit()
        return {'success': True, 'id': cursor.lastrowid}

@app.delete("/questions/standard/{question_id}")
async def delete_question(question_id: int):
    """Delete question."""
    db = require_db()
    db.execute('DELETE FROM questions WHERE id = ?', (question_id,))
    db.commit()
    return {'success': True}

# Cloud criteria endpoints
@app.get("/questions/cloud")
async def get_cloud_criteria():
    """Get all cloud scorecard criteria."""
    db = require_db()
    rows = db.execute('SELECT * FROM cloud_criteria ORDER BY id').fetchall()
    criteria = []
    for row in rows:
        c = dict(row)
        # Parse maturity_levels JSON
        c['maturity_levels'] = json.loads(c['maturity_levels']) if c.get('maturity_levels') else {}
        criteria.append(c)
    return criteria

@app.post("/questions/cloud")
async def save_cloud_criterion(criterion: Dict):
    """Save cloud criterion."""
    db = require_db()
    maturity_json = json.dumps(criterion.get('maturity_levels', {}))
    
    if criterion.get('id'):
        db.execute('''
            UPDATE cloud_criteria 
            SET category = ?, criterion = ?, description = ?, criticality = ?,
                points = ?, osint_source = ?, maturity_levels = ?, notes = ?
            WHERE id = ?
        ''', (
            criterion.get('category'), criterion['criterion'],
            criterion.get('description'), criterion.get('criticality'),
            criterion.get('points'), criterion.get('osint_source'), maturity_json, criterion.get('notes'), criterion['id']
        ))
        db.commit()
        return {'success': True, 'id': criterion['id']}
    else:
        cursor = db.execute('''
            INSERT INTO cloud_criteria (category, criterion, description, criticality, points, osint_source, maturity_levels, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            criterion.get('category'), criterion['criterion'],
            criterion.get('description'), criterion.get('criticality'),
            criterion.get('points'), criterion.get('osint_source'), maturity_json, criterion.get('notes')
        ))
        db.commit()
        return {'success': True, 'id': cursor.lastrowid}

@app.delete("/questions/cloud/{criterion_id}")
async def delete_cloud_criterion(criterion_id: int):
    """Delete cloud criterion."""
    db = require_db()
    db.execute('DELETE FROM cloud_criteria WHERE id = ?', (criterion_id,))
    db.commit()
    return {'success': True}

# Settings endpoints
@app.get("/settings")
async def get_settings():
    """Get application settings."""
    db = require_db()
    rows = db.execute('SELECT * FROM settings').fetchall()
    settings = {}
    for row in rows:
        settings[row['key']] = row['value']
    return settings

@app.post("/settings")
async def save_settings(settings: SettingsUpdate):
    """Save settings."""
    db = require_db()
    
    if settings.orgName:
        db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('orgName', settings.orgName))
    
    db.commit()
    return {'success': True}

# Assessment calculation endpoint
@app.post("/assessment/calculate")
async def calculate_assessment(req: AssessmentCalculate):
    """Calculate risk scores from assessment data."""
    if req.assessment_type == 'standard' and req.answers:
        # Standard assessment
        vuln = calc.calc_vulnerability(req.answers, req.questions or [], req.osintResults)
        impact, likelihood = calc.calc_impact_likelihood(req.answers, req.questions or [], req.osintResults)
        
        return {
            'vulnerability': vuln,
            'impact': impact,
            'likelihood': likelihood,
        }
    elif req.assessment_type == 'cloud' and req.cloudScores:
        # Cloud scorecard - scores are now maturity levels (0-5) not booleans
        result = calc.calc_cloud_vulnerability(req.cloudScores, req.criteria or [], req.osintResults)
        
        # Calculate impact/likelihood from cloud score using new thresholds
        # 45-55: Elite (impact/likelihood = 2)
        # 30-44: Standard (impact/likelihood = 3)
        # 15-29: Deficient (impact/likelihood = 4)
        # 0-14: Critical (impact/likelihood = 5)
        score = result['score']
        impact = 5 if score < 15 else (4 if score < 30 else (3 if score < 45 else 2))
        likelihood = 5 if score < 15 else (4 if score < 30 else (3 if score < 45 else 2))
        
        # Apply OSINT adjustments - only ransomware affects likelihood
        # Impact is determined by data classification tier only, not by OSINT results
        if req.osintResults:
            if req.osintResults.get('ransomware') is True:
                # Ransomware increases likelihood but does NOT affect impact
                # Impact should remain based on data classification tier
                likelihood = 5
        
        return {
            'vulnerability': result['vulnerability'],
            'impact': impact,
            'likelihood': likelihood,
            'score': result['score'],
            'maxScore': result['maxScore'],
            'status': result['status'],
            'statusColor': result['statusColor'],
            'missedCritical': result['missedCritical'],
        }
    
    raise HTTPException(status_code=400, detail='Invalid assessment data')

# OSINT endpoints
@app.post("/osint/scan/{vendor_id}")
async def scan_osint(vendor_id: int):
    """Run OSINT scan for a vendor."""
    db = require_db()
    
    # Get vendor
    vendor_row = db.execute('SELECT * FROM vendors WHERE id = ?', (vendor_id,)).fetchone()
    if not vendor_row:
        raise HTTPException(status_code=404, detail='Vendor not found')
    
    vendor = dict(vendor_row)
    osint_urls = json.loads(vendor.get('osint_urls') or '{}')
    
    # Sanity check: need primary domain
    primary_domain = osint_urls.get('primary_domain')
    if not primary_domain:
        # Fallback to vendor name
        if vendor.get('name'):
            primary_domain = vendor['name'].lower().replace(' ', '') + '.com'
        else:
            raise HTTPException(status_code=400, detail='No domain provided for OSINT scan')
    
    # Add vendor name to osint_urls
    osint_urls['vendor_name'] = vendor.get('name', '')
    
    # Run scan
    results = osint_service.scan_vendor(primary_domain, osint_urls)
    
    # Update vendor with OSINT results
    warnings_json = json.dumps(results['warnings'])
    db.execute('UPDATE vendors SET osint_warnings = ? WHERE id = ?', (warnings_json, vendor_id))
    
    # Recalculate vulnerability with OSINT knockout
    current_vendor = db.execute('SELECT * FROM vendors WHERE id = ?', (vendor_id,)).fetchone()
    if current_vendor:
        new_vuln = current_vendor['vulnerability'] or 100
        
        if results['osintResults']:
            if results['osintResults'].get('ransomware') is True:
                new_vuln = 100
            elif results['osintResults'].get('ssl') in ('F', 'Expired'):
                new_vuln = max(new_vuln, 80)
        
        db.execute('UPDATE vendors SET vulnerability = ? WHERE id = ?', (new_vuln, vendor_id))
    
    db.commit()
    
    return {
        'success': True,
        'results': results,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

