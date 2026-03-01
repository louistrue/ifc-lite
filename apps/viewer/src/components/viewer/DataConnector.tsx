/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Data Connector UI - Import data from CSV files and map to IFC properties
 *
 * Full integration with CsvConnector from @ifc-lite/mutations
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Link2,
  ArrowRight,
  Check,
  AlertCircle,
  Loader2,
  Trash2,
  Plus,
  Eye,
  Play,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { PropertyValueType } from '@ifc-lite/data';
import {
  CsvConnector,
  MutablePropertyView,
  type CsvRow,
  type MatchStrategy,
  type PropertyMapping,
  type DataMapping,
  type MatchResult,
  type ImportStats,
} from '@ifc-lite/mutations';
import { extractPropertiesOnDemand, extractQuantitiesOnDemand, type IfcDataStore } from '@ifc-lite/parser';

type MatchType = 'globalId' | 'expressId' | 'name' | 'property';

interface DataConnectorProps {
  trigger?: React.ReactNode;
}

interface CsvColumn {
  name: string;
  sampleValues: string[];
}

interface MappingRow {
  id: string;
  sourceColumn: string;
  targetPset: string;
  targetProperty: string;
  valueType: PropertyValueType;
}

export function DataConnector({ trigger }: DataConnectorProps) {
  const { models } = useIfc();
  const getMutationView = useViewerStore((s) => s.getMutationView);
  const registerMutationView = useViewerStore((s) => s.registerMutationView);
  // Also get legacy single-model state for backward compatibility
  const legacyIfcDataStore = useViewerStore((s) => s.ifcDataStore);
  const legacyGeometryResult = useViewerStore((s) => s.geometryResult);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  // Raw CSV content
  const [csvContent, setCsvContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');

  // Parsed CSV data for preview
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([]);
  const [csvColumns, setCsvColumns] = useState<CsvColumn[]>([]);

  // Matching configuration
  const [matchType, setMatchType] = useState<MatchType>('globalId');
  const [matchColumn, setMatchColumn] = useState<string>('');
  const [matchPset, setMatchPset] = useState<string>('');
  const [matchProp, setMatchProp] = useState<string>('');

  // Property mappings
  const [mappings, setMappings] = useState<MappingRow[]>([]);

  // Results
  const [matchResults, setMatchResults] = useState<MatchResult[] | null>(null);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get list of models - includes both federated models and legacy single-model
  const modelList = useMemo(() => {
    const list = Array.from(models.values()).map((m) => ({
      id: m.id,
      name: m.name,
    }));

    // If no models in Map but legacy data exists, add a synthetic entry
    if (list.length === 0 && legacyIfcDataStore) {
      list.push({
        id: '__legacy__',
        name: 'Current Model',
      });
    }

    return list;
  }, [models, legacyIfcDataStore]);

  // Get selected model's data - supports both federated and legacy mode
  const selectedModel = useMemo(() => {
    if (selectedModelId === '__legacy__' && legacyIfcDataStore && legacyGeometryResult) {
      // Return a synthetic FederatedModel-like object for legacy mode
      return {
        id: '__legacy__',
        name: 'Current Model',
        ifcDataStore: legacyIfcDataStore,
        geometryResult: legacyGeometryResult,
        visible: true,
        collapsed: false,
      };
    }
    return models.get(selectedModelId);
  }, [models, selectedModelId, legacyIfcDataStore, legacyGeometryResult]);

  // Auto-select first model
  useMemo(() => {
    if (modelList.length > 0 && !selectedModelId) {
      setSelectedModelId(modelList[0].id);
    }
  }, [modelList, selectedModelId]);

  // Ensure mutation view exists for selected model
  useEffect(() => {
    if (!selectedModel?.ifcDataStore || !selectedModelId) return;

    // Check if mutation view already exists
    let mutationView = getMutationView(selectedModelId);
    if (mutationView) return;

    // Create new mutation view with on-demand property extractor
    const dataStore = selectedModel.ifcDataStore;
    mutationView = new MutablePropertyView(dataStore.properties || null, selectedModelId);

    // Set up on-demand property extraction if the data store supports it
    if (dataStore.onDemandPropertyMap && dataStore.source?.length > 0) {
      mutationView.setOnDemandExtractor((entityId: number) => {
        return extractPropertiesOnDemand(dataStore as IfcDataStore, entityId);
      });
    }

    // Set up on-demand quantity extraction if the data store supports it
    if (dataStore.onDemandQuantityMap && dataStore.source?.length > 0) {
      mutationView.setQuantityExtractor((entityId: number) => {
        return extractQuantitiesOnDemand(dataStore as IfcDataStore, entityId);
      });
    }

    // Register the mutation view
    registerMutationView(selectedModelId, mutationView);
  }, [selectedModel, selectedModelId, getMutationView, registerMutationView]);

  // Create CsvConnector instance
  const csvConnector = useMemo(() => {
    if (!selectedModel?.ifcDataStore) return null;

    const mutationView = getMutationView(selectedModelId);
    if (!mutationView) return null;

    const dataStore = selectedModel.ifcDataStore;

    return new CsvConnector(
      dataStore.entities,
      mutationView,
      dataStore.strings || null
    );
  }, [selectedModel, selectedModelId, getMutationView]);

  // Parse CSV file
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setMatchResults(null);
    setImportStats(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      setCsvContent(text);

      // Use CsvConnector to parse if available, otherwise do basic parsing for preview
      if (csvConnector) {
        try {
          const rows = csvConnector.parse(text);
          setParsedRows(rows);

          // Extract column names and sample values
          if (rows.length > 0) {
            const headers = Object.keys(rows[0]);
            const columns: CsvColumn[] = headers.map((name) => ({
              name,
              sampleValues: rows.slice(0, 3).map((row) => row[name] || ''),
            }));
            setCsvColumns(columns);

            // Auto-detect match column
            const globalIdCol = columns.find(
              (c) =>
                c.name.toLowerCase().includes('globalid') ||
                c.name.toLowerCase().includes('guid')
            );
            if (globalIdCol) {
              setMatchColumn(globalIdCol.name);
              setMatchType('globalId');
            }

            // Auto-detect property mappings
            const autoMappings = csvConnector.autoDetectMappings(headers);
            const mappingRows: MappingRow[] = autoMappings.map((m, idx) => ({
              id: `auto_${idx}_${Date.now()}`,
              sourceColumn: m.sourceColumn,
              targetPset: m.targetPset,
              targetProperty: m.targetProperty,
              valueType: m.valueType,
            }));

            // Filter out ID columns from auto mappings
            const filteredMappings = mappingRows.filter(
              (m) =>
                !m.sourceColumn.toLowerCase().includes('globalid') &&
                !m.sourceColumn.toLowerCase().includes('expressid') &&
                !m.sourceColumn.toLowerCase().includes('guid') &&
                m.sourceColumn.toLowerCase() !== 'id'
            );

            if (filteredMappings.length > 0) {
              setMappings(filteredMappings);
            }
          }
        } catch (err) {
          setError(`Failed to parse CSV: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      } else {
        // Basic parsing for preview before model selected
        const lines = text.split('\n').filter((line) => line.trim());
        if (lines.length < 2) {
          setError('CSV must have at least a header row and one data row');
          return;
        }

        const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
        const columns: CsvColumn[] = headers.map((name, idx) => ({
          name,
          sampleValues: lines
            .slice(1, 4)
            .map((line) => {
              const values = line.split(',');
              return values[idx]?.trim().replace(/^"|"$/g, '') || '';
            }),
        }));
        setCsvColumns(columns);

        // Auto-detect match column
        const globalIdCol = columns.find(
          (c) =>
            c.name.toLowerCase().includes('globalid') ||
            c.name.toLowerCase().includes('guid')
        );
        if (globalIdCol) {
          setMatchColumn(globalIdCol.name);
          setMatchType('globalId');
        }
      }
    };

    reader.readAsText(file);
    e.target.value = ''; // Reset input
  }, [csvConnector]);

  // Re-parse when model changes and we have content
  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
    setMatchResults(null);
    setImportStats(null);
    setError(null);
  }, []);

  // Add a mapping row
  const addMapping = useCallback(() => {
    setMappings((prev) => [
      ...prev,
      {
        id: `mapping_${Date.now()}`,
        sourceColumn: '',
        targetPset: 'Pset_Custom',
        targetProperty: '',
        valueType: PropertyValueType.String,
      },
    ]);
  }, []);

  // Remove a mapping
  const removeMapping = useCallback((id: string) => {
    setMappings((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // Update a mapping
  const updateMapping = useCallback(
    (id: string, field: keyof MappingRow, value: string | number) => {
      setMappings((prev) =>
        prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
      );
    },
    []
  );

  // Auto-detect mappings
  const handleAutoDetect = useCallback(() => {
    if (!csvConnector || csvColumns.length === 0) return;

    const headers = csvColumns.map((c) => c.name);
    const autoMappings = csvConnector.autoDetectMappings(headers);

    const mappingRows: MappingRow[] = autoMappings
      .filter(
        (m) =>
          !m.sourceColumn.toLowerCase().includes('globalid') &&
          !m.sourceColumn.toLowerCase().includes('expressid') &&
          !m.sourceColumn.toLowerCase().includes('guid') &&
          m.sourceColumn.toLowerCase() !== 'id'
      )
      .map((m, idx) => ({
        id: `auto_${idx}_${Date.now()}`,
        sourceColumn: m.sourceColumn,
        targetPset: m.targetPset,
        targetProperty: m.targetProperty,
        valueType: m.valueType,
      }));

    setMappings(mappingRows);
  }, [csvConnector, csvColumns]);

  // Build DataMapping from UI state
  const buildDataMapping = useCallback((): DataMapping | null => {
    if (!matchColumn) return null;

    const matchStrategy: MatchStrategy =
      matchType === 'property'
        ? { type: 'property', psetName: matchPset, propName: matchProp, column: matchColumn }
        : { type: matchType, column: matchColumn };

    const propertyMappings: PropertyMapping[] = mappings
      .filter((m) => m.sourceColumn && m.targetProperty)
      .map((m) => ({
        sourceColumn: m.sourceColumn,
        targetPset: m.targetPset,
        targetProperty: m.targetProperty,
        valueType: m.valueType,
      }));

    return { matchStrategy, propertyMappings };
  }, [matchColumn, matchType, matchPset, matchProp, mappings]);

  // Preview matches using CsvConnector.preview
  const handlePreview = useCallback(() => {
    if (!csvConnector || !csvContent || !matchColumn) return;

    setIsProcessing(true);
    setMatchResults(null);
    setImportStats(null);
    setError(null);

    try {
      const dataMapping = buildDataMapping();
      if (!dataMapping) {
        setError('Invalid mapping configuration');
        setIsProcessing(false);
        return;
      }

      // Use CsvConnector preview method
      const preview = csvConnector.preview(csvContent, dataMapping);

      setParsedRows(preview.rows);
      setMatchResults(preview.matches);
    } catch (err) {
      console.error('Preview failed:', err);
      setError(`Preview failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  }, [csvConnector, csvContent, matchColumn, buildDataMapping]);

  // Import using CsvConnector.import
  const handleImport = useCallback(() => {
    if (!csvConnector || !csvContent) return;

    setIsProcessing(true);
    setImportStats(null);
    setError(null);

    try {
      const dataMapping = buildDataMapping();
      if (!dataMapping) {
        setError('Invalid mapping configuration');
        setIsProcessing(false);
        return;
      }

      // Use CsvConnector import method - this creates mutations via the MutablePropertyView
      const stats = csvConnector.import(csvContent, dataMapping);

      setImportStats(stats);

      if (stats.errors.length > 0) {
        setError(stats.errors.join('\n'));
      }
    } catch (err) {
      console.error('Import failed:', err);
      setError(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  }, [csvConnector, csvContent, buildDataMapping]);

  // Stats from match results
  const matchStats = useMemo(() => {
    if (!matchResults) return null;
    const matched = matchResults.filter((r) => r.matchedEntityIds.length > 0).length;
    const unmatched = matchResults.filter((r) => r.matchedEntityIds.length === 0).length;
    const multiMatch = matchResults.filter((r) => r.matchedEntityIds.length > 1).length;
    const highConfidence = matchResults.filter((r) => r.confidence === 1).length;
    return { matched, unmatched, multiMatch, highConfidence, total: matchResults.length };
  }, [matchResults]);

  // Convert parsed rows to array for table display
  const previewData = useMemo(() => {
    if (parsedRows.length === 0) return [];
    return parsedRows.slice(0, 5).map((row) => {
      return csvColumns.map((col) => row[col.name] || '');
    });
  }, [parsedRows, csvColumns]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Import Data
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import External Data
          </DialogTitle>
          <DialogDescription>
            Import property data from CSV files and map to IFC entities using CsvConnector
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Model selector - first so CsvConnector can be created */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Target Model</Label>
            <Select value={selectedModelId} onValueChange={handleModelChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {modelList.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedModelId && !csvConnector && (
              <p className="text-xs text-amber-600">
                Note: MutationView not available for this model. Some features may be limited.
              </p>
            )}
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">CSV File</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                Choose File
              </Button>
              {fileName && <Badge variant="secondary">{fileName}</Badge>}
            </div>
          </div>

          {csvColumns.length > 0 && (
            <>
              <Separator />

              {/* CSV Preview */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Data Preview</Label>
                <ScrollArea className="h-32 border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {csvColumns.map((col) => (
                          <TableHead key={col.name} className="text-xs whitespace-nowrap">
                            {col.name}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.map((row, rowIdx) => (
                        <TableRow key={rowIdx}>
                          {row.map((cell, cellIdx) => (
                            <TableCell key={cellIdx} className="text-xs py-1">
                              {cell || '—'}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                <p className="text-xs text-muted-foreground">
                  {parsedRows.length > 0
                    ? `${parsedRows.length} rows parsed`
                    : `${csvColumns[0]?.sampleValues.length || 0} sample rows`}
                </p>
              </div>

              <Separator />

              {/* Matching Configuration */}
              <div className="space-y-4">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Match Configuration
                </Label>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Match By</Label>
                    <Select value={matchType} onValueChange={(v) => setMatchType(v as MatchType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="globalId">GlobalId</SelectItem>
                        <SelectItem value="expressId">EXPRESS ID</SelectItem>
                        <SelectItem value="name">Entity Name</SelectItem>
                        <SelectItem value="property">Property Value</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Match Column</Label>
                    <Select value={matchColumn} onValueChange={setMatchColumn}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {csvColumns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.name}
                            {col.sampleValues[0] && (
                              <span className="ml-2 text-muted-foreground">
                                (e.g., {col.sampleValues[0].slice(0, 20)})
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {matchType === 'property' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Property Set</Label>
                      <Input
                        value={matchPset}
                        onChange={(e) => setMatchPset(e.target.value)}
                        placeholder="e.g., Pset_WallCommon"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Property Name</Label>
                      <Input
                        value={matchProp}
                        onChange={(e) => setMatchProp(e.target.value)}
                        placeholder="e.g., Reference"
                      />
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              {/* Property Mappings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Property Mappings</Label>
                  <div className="flex items-center gap-2">
                    {csvConnector && (
                      <Button variant="ghost" size="sm" onClick={handleAutoDetect}>
                        <Wand2 className="h-3 w-3 mr-1" />
                        Auto-detect
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={addMapping}>
                      <Plus className="h-3 w-3 mr-1" />
                      Add Mapping
                    </Button>
                  </div>
                </div>

                {mappings.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Add mappings to import column values as IFC properties
                  </p>
                ) : (
                  <div className="space-y-2">
                    {mappings.map((mapping) => (
                      <div
                        key={mapping.id}
                        className="flex items-center gap-2 p-2 border rounded-md bg-muted/30"
                      >
                        <Select
                          value={mapping.sourceColumn}
                          onValueChange={(v) => updateMapping(mapping.id, 'sourceColumn', v)}
                        >
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue placeholder="Column" />
                          </SelectTrigger>
                          <SelectContent>
                            {csvColumns.map((col) => (
                              <SelectItem key={col.name} value={col.name}>
                                {col.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

                        <Input
                          placeholder="Pset name"
                          value={mapping.targetPset}
                          onChange={(e) => updateMapping(mapping.id, 'targetPset', e.target.value)}
                          className="h-8 text-xs w-32"
                        />

                        <Input
                          placeholder="Property"
                          value={mapping.targetProperty}
                          onChange={(e) =>
                            updateMapping(mapping.id, 'targetProperty', e.target.value)
                          }
                          className="h-8 text-xs flex-1"
                        />

                        <Select
                          value={mapping.valueType.toString()}
                          onValueChange={(v) => updateMapping(mapping.id, 'valueType', parseInt(v))}
                        >
                          <SelectTrigger className="h-8 w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={PropertyValueType.String.toString()}>
                              String
                            </SelectItem>
                            <SelectItem value={PropertyValueType.Real.toString()}>Real</SelectItem>
                            <SelectItem value={PropertyValueType.Integer.toString()}>
                              Integer
                            </SelectItem>
                            <SelectItem value={PropertyValueType.Boolean.toString()}>
                              Boolean
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => removeMapping(mapping.id)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Match Results */}
              {matchStats && (
                <Alert>
                  <Eye className="h-4 w-4" />
                  <AlertTitle>Match Results</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">{matchStats.matched} matched</Badge>
                    <Badge variant="secondary">{matchStats.unmatched} unmatched</Badge>
                    <Badge variant="outline">{matchStats.highConfidence} high confidence</Badge>
                    {matchStats.multiMatch > 0 && (
                      <Badge variant="destructive">{matchStats.multiMatch} multi-match</Badge>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Import Stats */}
              {importStats && (
                <Alert variant={importStats.errors.length === 0 ? 'default' : 'destructive'}>
                  <Check className="h-4 w-4" />
                  <AlertTitle>Import Complete</AlertTitle>
                  <AlertDescription>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <Badge variant="default">
                        {importStats.mutationsCreated} properties updated
                      </Badge>
                      <Badge variant="secondary">{importStats.matchedRows} rows matched</Badge>
                      <Badge variant="outline">{importStats.unmatchedRows} rows unmatched</Badge>
                    </div>
                    {importStats.warnings.length > 0 && (
                      <div className="mt-2 text-xs text-amber-600">
                        {importStats.warnings.length} warning(s)
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Error Display */}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="secondary"
            onClick={handlePreview}
            disabled={!csvConnector || !csvContent || !matchColumn || isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Eye className="h-4 w-4 mr-2" />
            )}
            Preview Matches
          </Button>
          <Button
            onClick={handleImport}
            disabled={
              !csvConnector ||
              !csvContent ||
              !matchResults ||
              matchStats?.matched === 0 ||
              mappings.length === 0 ||
              isProcessing
            }
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Import {matchStats?.matched || 0} rows
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
