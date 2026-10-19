import React, { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/app/ToastProvider';
import { Button } from './Button';
import { Dialog } from './Dialog';
import type { ImportResult } from '@/types/api';

interface CSVImportDialogProps {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  queryKey: string[];
  title: string;
  description: string;
  templateUrl?: string;
  templateName?: string;
  /**
   * Additional cache prefixes to invalidate after a successful import. Imports
   * feed derived screens (dashboards, exposure, insights) that are cached
   * separately from the list being imported into.
   */
  invalidateKeys?: string[][];
}

export function CSVImportDialog({
  open,
  onClose,
  endpoint,
  queryKey,
  title,
  description,
  templateUrl,
  templateName,
  invalidateKeys,
}: CSVImportDialogProps) {
  const { push } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post<ImportResult>(endpoint, undefined, { formData });
    },
    onSuccess: async (data) => {
      setResult(data);
      push({
        tone: data.rows_failed ? 'warning' : 'success',
        title: `${data.rows_created} record${data.rows_created === 1 ? '' : 's'} imported`,
        description: data.rows_failed
          ? `${data.rows_failed} row${data.rows_failed === 1 ? '' : 's'} could not be read and are listed below.`
          : 'Every row in the file was imported.',
      });
      await queryClient.invalidateQueries({ queryKey });
      for (const key of invalidateKeys ?? []) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  const close = () => {
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importMutation.mutate(file);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {templateUrl && (
            <a
              href={templateUrl}
              download={templateName || 'template.csv'}
              className="flex items-center gap-2 text-2xs text-muted hover:text-foreground transition-colors"
            >
              <Download className="h-3 w-3" />
              Download template
            </a>
          )}
          <div className="flex items-center gap-3 ml-auto">
            <Button variant="ghost" onClick={close}>
              {result ? 'Close' : 'Cancel'}
            </Button>
            {!result && (
              <Button
                variant="primary"
                icon={<Upload className="h-3.5 w-3.5" />}
                loading={importMutation.isPending}
                onClick={() => inputRef.current?.click()}
              >
                Select CSV file
              </Button>
            )}
          </div>
        </div>
      }
    >
      <input
        type="file"
        ref={inputRef}
        className="hidden"
        accept=".csv"
        onChange={handleFileChange}
      />

      <div className="space-y-6">
        {importMutation.isError && (
          <div className="rounded-md bg-critical/10 p-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-critical flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-critical">Import failed</p>
                <p className="text-xs text-critical/80">
                  {importMutation.error instanceof Error ? importMutation.error.message : 'Unknown error'}
                </p>
              </div>
            </div>
          </div>
        )}

        {result ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border bg-surface p-4 text-center">
                <p className="text-2xs font-medium text-muted uppercase tracking-wider">Total</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{result.rows_total}</p>
              </div>
              <div className="rounded-lg border bg-surface p-4 text-center">
                <p className="text-2xs font-medium text-muted uppercase tracking-wider text-success">Created</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-success">{result.rows_created}</p>
              </div>
              <div className="rounded-lg border bg-surface p-4 text-center">
                <p className="text-2xs font-medium text-muted uppercase tracking-wider text-critical">Failed</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-critical">{result.rows_failed}</p>
              </div>
            </div>

            {(result.errors?.length ?? 0) > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-warning" />
                  Validation errors
                </h4>
                <div className="max-h-60 overflow-y-auto rounded-md border bg-surface/50">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-surface border-b">
                      <tr>
                        <th className="px-3 py-2 font-medium text-muted w-16">Row</th>
                        <th className="px-3 py-2 font-medium text-muted">Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.errors?.map((err, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 tabular-nums font-medium">{err.row}</td>
                          <td className="px-3 py-2 text-muted">{err.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result.rows_failed === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="rounded-full bg-success/10 p-3 mb-3">
                  <CheckCircle2 className="h-8 w-8 text-success" />
                </div>
                <h4 className="text-sm font-medium">Import complete</h4>
                <p className="text-xs text-muted mt-1">Every row was successfully processed and stored.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
            <div className="rounded-full bg-muted/10 p-4 mb-4">
              <Upload className="h-10 w-10 text-muted/40" />
            </div>
            <p className="text-sm font-medium">No file selected</p>
            <p className="text-xs text-muted mt-1 max-w-xs">
              Select a CSV file to begin validation. Large files may take a moment to process.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
