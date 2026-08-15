import {
  AlertTriangle,
  Check,
  Database,
  KeyRound,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  applySchemaPlan,
  createDataField,
  createDataRelation,
  createDataTable,
  createSchemaPlan,
  DataSchemaApiError,
  deleteDataField,
  deleteDataRelation,
  deleteDataTable,
  getDataSchema,
  patchDataField,
  patchDataTable,
  type DataFieldType,
  type DataRelationDto,
  type DataSchemaDto,
  type DataTableDto,
  type DataTableTemplate,
  type SchemaMigrationPlanDto,
} from "@/services/data-schema-api";

const FIELD_TYPES: readonly DataFieldType[] = [
  "INTEGER",
  "REAL",
  "TEXT",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "JSON",
  "BLOB",
];

function message(error: unknown): string {
  if (error instanceof DataSchemaApiError) {
    if (error.status === 409) return "변경 충돌";
    return error.message;
  }
  return "요청 실패";
}

interface DatabaseDesignerProps {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly onProjectRevisionChange: (revision: number) => void;
}

export function DatabaseDesigner({
  projectId,
  projectRevision,
  onProjectRevisionChange,
}: DatabaseDesignerProps) {
  const [schema, setSchema] = useState<DataSchemaDto | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableDialog, setTableDialog] = useState(false);
  const [fieldDialog, setFieldDialog] = useState(false);
  const [relationDialog, setRelationDialog] = useState(false);
  const [deleteTableTarget, setDeleteTableTarget] =
    useState<DataTableDto | null>(null);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<{
    readonly table: DataTableDto;
    readonly fieldId: string;
    readonly name: string;
    readonly revision: number;
  } | null>(null);
  const [deleteRelationTarget, setDeleteRelationTarget] =
    useState<DataRelationDto | null>(null);
  const [renameTableTarget, setRenameTableTarget] =
    useState<DataTableDto | null>(null);
  const [renameTableName, setRenameTableName] = useState("");
  const [renameFieldTarget, setRenameFieldTarget] = useState<{
    readonly fieldId: string;
    readonly revision: number;
    readonly name: string;
  } | null>(null);
  const [renameFieldName, setRenameFieldName] = useState("");
  const [migrationPlan, setMigrationPlan] =
    useState<SchemaMigrationPlanDto | null>(null);
  const [tableName, setTableName] = useState("");
  const [tableTemplate, setTableTemplate] =
    useState<DataTableTemplate>("BLANK");
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<DataFieldType>("TEXT");
  const [fieldNullable, setFieldNullable] = useState(true);
  const [fieldIndexed, setFieldIndexed] = useState(false);
  const [relationName, setRelationName] = useState("");
  const [relationSource, setRelationSource] = useState("");
  const [relationTarget, setRelationTarget] = useState("");
  const revisionRef = useRef({ projectId, revision: projectRevision });
  const revisionCallbackRef = useRef(onProjectRevisionChange);
  if (revisionRef.current.projectId !== projectId) {
    revisionRef.current = { projectId, revision: projectRevision };
  } else {
    revisionRef.current.revision = Math.max(
      revisionRef.current.revision,
      projectRevision,
    );
  }
  revisionCallbackRef.current = onProjectRevisionChange;

  const reportProjectRevision = useCallback((revision: number) => {
    const next = Math.max(revisionRef.current.revision, revision);
    revisionRef.current.revision = next;
    revisionCallbackRef.current(next);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const next = await getDataSchema(projectId, signal);
        setSchema(next);
        reportProjectRevision(next.projectRevision);
        setSelectedTableId((current) =>
          next.tables.some((table) => table.id === current)
            ? current
            : (next.tables[0]?.id ?? null),
        );
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(message(cause));
        }
      } finally {
        setLoading(false);
      }
    },
    [projectId, reportProjectRevision],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const selectedTable = useMemo(
    () => schema?.tables.find((table) => table.id === selectedTableId) ?? null,
    [schema, selectedTableId],
  );
  const fieldOptions = useMemo(
    () =>
      (schema?.tables ?? []).flatMap((table) =>
        table.fields.map((field) => ({ table, field })),
      ),
    [schema],
  );

  const acceptSchema = useCallback(
    (next: DataSchemaDto) => {
      setSchema(next);
      reportProjectRevision(next.projectRevision);
      setError(null);
    },
    [reportProjectRevision],
  );

  const run = useCallback(
    async (operation: () => Promise<DataSchemaDto>) => {
      setBusy(true);
      setError(null);
      try {
        acceptSchema(await operation());
        return true;
      } catch (cause) {
        setError(message(cause));
        if (cause instanceof DataSchemaApiError && cause.status === 409) {
          await load();
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [acceptSchema, load],
  );

  const submitTable = async () => {
    if (!schema || tableName.trim().length === 0) return;
    const ok = await run(() =>
      createDataTable(projectId, {
        displayName: tableName.trim(),
        template: tableTemplate,
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
      }),
    );
    if (ok) {
      setTableDialog(false);
      setTableName("");
      setTableTemplate("BLANK");
    }
  };

  const submitField = async () => {
    if (!schema || !selectedTable || fieldName.trim().length === 0) return;
    const ok = await run(() =>
      createDataField(selectedTable.id, {
        displayName: fieldName.trim(),
        type: fieldType,
        nullable: fieldNullable,
        indexed: fieldIndexed,
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
      }),
    );
    if (ok) {
      setFieldDialog(false);
      setFieldName("");
      setFieldType("TEXT");
      setFieldNullable(true);
      setFieldIndexed(false);
    }
  };

  const submitRelation = async () => {
    if (!schema || !relationSource || !relationTarget || !relationName.trim())
      return;
    const source = fieldOptions.find(
      ({ field }) => field.id === relationSource,
    );
    const target = fieldOptions.find(
      ({ field }) => field.id === relationTarget,
    );
    if (!source || !target) return;
    const ok = await run(() =>
      createDataRelation(projectId, {
        displayName: relationName.trim(),
        type: "MANY_TO_ONE",
        sourceTableId: source.table.id,
        sourceFieldId: source.field.id,
        targetTableId: target.table.id,
        targetFieldId: target.field.id,
        onDelete: "RESTRICT",
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
      }),
    );
    if (ok) {
      setRelationDialog(false);
      setRelationName("");
      setRelationSource("");
      setRelationTarget("");
    }
  };

  const prepareMigration = async () => {
    if (!schema) return;
    setBusy(true);
    setError(null);
    try {
      setMigrationPlan((await createSchemaPlan(schema)).plan);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const applyMigration = async () => {
    if (!schema || !migrationPlan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applySchemaPlan(
        schema,
        migrationPlan.id,
        migrationPlan.impact.destructive,
      );
      acceptSchema(result.schema);
      setMigrationPlan(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  if (loading && schema === null) {
    return (
      <div className="schema-status" role="status">
        <LoaderCircle className="animate-spin" aria-hidden="true" />
        불러오는 중
      </div>
    );
  }

  if (schema === null) {
    return (
      <div className="schema-status" role="alert">
        <AlertTriangle aria-hidden="true" />
        <span>{error ?? "불러오기 실패"}</span>
        <Button type="button" variant="outline" onClick={() => void load()}>
          다시 시도
        </Button>
      </div>
    );
  }

  return (
    <section className="database-designer" aria-label="데이터베이스 설계">
      <header className="schema-header">
        <div>
          <strong>스키마</strong>
          <span>r{schema.schemaRevision}</span>
        </div>
        <div className="schema-header-actions">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRelationDialog(true)}
            disabled={busy || schema.tables.length < 2}
          >
            <Link2 aria-hidden="true" />
            관계
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setTableDialog(true)}
            disabled={busy}
          >
            <Plus aria-hidden="true" />
            테이블
          </Button>
          <Button
            type="button"
            onClick={() => void prepareMigration()}
            disabled={busy}
          >
            <ShieldCheck aria-hidden="true" />
            적용 계획
          </Button>
        </div>
      </header>

      <div className="schema-runtime-status" aria-label="런타임 스키마 상태">
        <span>
          <Database aria-hidden="true" />
          Test
          <Badge
            variant={schema.runtime.test.drift ? "destructive" : "secondary"}
          >
            {schema.runtime.test.drift ? "변경 있음" : "일치"}
          </Badge>
        </span>
        <span>
          <Database aria-hidden="true" />
          Production
          <Badge
            variant={schema.runtime.production.drift ? "outline" : "secondary"}
          >
            {schema.runtime.production.drift ? "미적용" : "일치"}
          </Badge>
        </span>
      </div>

      {error && (
        <div className="schema-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          {error}
        </div>
      )}

      <div className="schema-body">
        <div className="schema-table-list" role="listbox" aria-label="테이블">
          {schema.tables.length === 0 ? (
            <div className="schema-empty">
              <Database aria-hidden="true" />
              <strong>테이블 없음</strong>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTableDialog(true)}
              >
                <Plus aria-hidden="true" />
                테이블
              </Button>
            </div>
          ) : (
            schema.tables.map((table) => (
              <button
                key={table.id}
                type="button"
                role="option"
                aria-selected={selectedTableId === table.id}
                className="schema-table-option"
                onClick={() => setSelectedTableId(table.id)}
              >
                <Database aria-hidden="true" />
                <span>
                  <strong>{table.displayName}</strong>
                  <code>{table.physicalName}</code>
                </span>
                <Badge variant="outline">{table.fields.length}</Badge>
              </button>
            ))
          )}
        </div>

        <div className="schema-table-detail">
          {selectedTable ? (
            <>
              <header>
                <div>
                  <strong>{selectedTable.displayName}</strong>
                  <code>{selectedTable.physicalName}</code>
                </div>
                <div className="schema-detail-actions">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRenameTableTarget(selectedTable);
                      setRenameTableName(selectedTable.displayName);
                    }}
                    disabled={busy}
                  >
                    <Pencil aria-hidden="true" />
                    이름
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setFieldDialog(true)}
                    disabled={busy}
                  >
                    <Plus aria-hidden="true" />
                    필드
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setDeleteTableTarget(selectedTable)}
                    disabled={busy}
                    aria-label={`${selectedTable.displayName} 삭제`}
                  >
                    <Trash2 aria-hidden="true" />
                    삭제
                  </Button>
                </div>
              </header>
              <div
                className="schema-field-table"
                role="table"
                aria-label={`${selectedTable.displayName} 필드`}
              >
                <div role="row" className="schema-field-head">
                  <span role="columnheader">필드</span>
                  <span role="columnheader">형식</span>
                  <span role="columnheader">옵션</span>
                  <span role="columnheader">작업</span>
                </div>
                {selectedTable.fields.map((field) => (
                  <div role="row" key={field.id}>
                    <span role="cell">
                      <strong>{field.displayName}</strong>
                      <code>{field.physicalName}</code>
                    </span>
                    <span role="cell">{field.type}</span>
                    <span role="cell" className="schema-field-flags">
                      {field.primaryKey && (
                        <Badge variant="secondary">
                          <KeyRound aria-hidden="true" />
                          PK
                        </Badge>
                      )}
                      {field.nullable && <Badge variant="outline">NULL</Badge>}
                      {field.unique && <Badge variant="outline">UNIQUE</Badge>}
                      {field.indexed && <Badge variant="outline">INDEX</Badge>}
                    </span>
                    <span role="cell">
                      <span className="schema-field-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={`${field.displayName} 이름 변경`}
                          onClick={() => {
                            setRenameFieldTarget({
                              fieldId: field.id,
                              revision: field.revision,
                              name: field.displayName,
                            });
                            setRenameFieldName(field.displayName);
                          }}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || selectedTable.fields.length <= 1}
                          aria-label={`${field.displayName} 삭제`}
                          onClick={() =>
                            setDeleteFieldTarget({
                              table: selectedTable,
                              fieldId: field.id,
                              name: field.displayName,
                              revision: field.revision,
                            })
                          }
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="schema-empty">
              <strong>테이블 선택</strong>
            </div>
          )}

          {schema.relations.length > 0 && (
            <div className="schema-relations">
              <strong>관계</strong>
              {schema.relations.map((relation) => (
                <div key={relation.id}>
                  <Link2 aria-hidden="true" />
                  <span>{relation.displayName}</span>
                  <Badge variant="outline">{relation.type}</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${relation.displayName} 삭제`}
                    onClick={() => setDeleteRelationTarget(relation)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={tableDialog} onOpenChange={setTableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>테이블 추가</DialogTitle>
            <DialogDescription>물리명은 자동 생성됩니다.</DialogDescription>
          </DialogHeader>
          <div className="schema-form">
            <Label htmlFor="schema-table-name">이름</Label>
            <Input
              id="schema-table-name"
              value={tableName}
              onChange={(event) => setTableName(event.target.value)}
              maxLength={120}
              autoFocus
            />
            <Label htmlFor="schema-table-template">템플릿</Label>
            <Select
              value={tableTemplate}
              onValueChange={(value) =>
                setTableTemplate(value as DataTableTemplate)
              }
            >
              <SelectTrigger id="schema-table-template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BLANK">기본</SelectItem>
                <SelectItem value="ENTITY">엔터티</SelectItem>
                <SelectItem value="TIME_SERIES">시계열</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="schema-dialog-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTableDialog(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={() => void submitTable()}
              disabled={busy || !tableName.trim()}
            >
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fieldDialog} onOpenChange={setFieldDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>필드 추가</DialogTitle>
            <DialogDescription>형식과 제약을 선택합니다.</DialogDescription>
          </DialogHeader>
          <div className="schema-form">
            <Label htmlFor="schema-field-name">이름</Label>
            <Input
              id="schema-field-name"
              value={fieldName}
              onChange={(event) => setFieldName(event.target.value)}
              maxLength={120}
              autoFocus
            />
            <Label htmlFor="schema-field-type">형식</Label>
            <Select
              value={fieldType}
              onValueChange={(value) => setFieldType(value as DataFieldType)}
            >
              <SelectTrigger id="schema-field-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="schema-switch-row">
              <Label htmlFor="schema-field-nullable">Null 허용</Label>
              <Switch
                id="schema-field-nullable"
                checked={fieldNullable}
                onCheckedChange={setFieldNullable}
              />
            </div>
            <div className="schema-switch-row">
              <Label htmlFor="schema-field-indexed">인덱스</Label>
              <Switch
                id="schema-field-indexed"
                checked={fieldIndexed}
                onCheckedChange={setFieldIndexed}
              />
            </div>
          </div>
          <DialogFooter className="schema-dialog-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFieldDialog(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={() => void submitField()}
              disabled={busy || !fieldName.trim()}
            >
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={relationDialog} onOpenChange={setRelationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>관계 추가</DialogTitle>
            <DialogDescription>
              외래 키와 고유 대상을 연결합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="schema-form">
            <Label htmlFor="schema-relation-name">이름</Label>
            <Input
              id="schema-relation-name"
              value={relationName}
              onChange={(event) => setRelationName(event.target.value)}
              autoFocus
            />
            <Label htmlFor="schema-relation-source">외래 키</Label>
            <Select value={relationSource} onValueChange={setRelationSource}>
              <SelectTrigger id="schema-relation-source">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {fieldOptions
                  .filter(({ field }) => field.nullable)
                  .map(({ table, field }) => (
                    <SelectItem key={field.id} value={field.id}>
                      {table.displayName} · {field.displayName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Label htmlFor="schema-relation-target">대상</Label>
            <Select value={relationTarget} onValueChange={setRelationTarget}>
              <SelectTrigger id="schema-relation-target">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {fieldOptions
                  .filter(({ field }) => field.primaryKey || field.unique)
                  .map(({ table, field }) => (
                    <SelectItem key={field.id} value={field.id}>
                      {table.displayName} · {field.displayName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="schema-dialog-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRelationDialog(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={() => void submitRelation()}
              disabled={
                busy ||
                !relationName.trim() ||
                !relationSource ||
                !relationTarget
              }
            >
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTableTarget !== null}
        onOpenChange={(open) => !open && setRenameTableTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>테이블 이름</DialogTitle>
            <DialogDescription>물리명은 유지됩니다.</DialogDescription>
          </DialogHeader>
          <div className="schema-form">
            <Label htmlFor="schema-table-rename">이름</Label>
            <Input
              id="schema-table-rename"
              value={renameTableName}
              onChange={(event) => setRenameTableName(event.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter className="schema-dialog-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameTableTarget(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={busy || !renameTableName.trim()}
              onClick={() => {
                const target = renameTableTarget;
                if (!target) return;
                void run(() =>
                  patchDataTable(target.id, {
                    displayName: renameTableName.trim(),
                    expectedRevision: target.revision,
                    expectedSchemaRevision: schema.schemaRevision,
                    expectedProjectRevision: schema.projectRevision,
                  }),
                ).then((ok) => ok && setRenameTableTarget(null));
              }}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameFieldTarget !== null}
        onOpenChange={(open) => !open && setRenameFieldTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>필드 이름</DialogTitle>
            <DialogDescription>물리명은 유지됩니다.</DialogDescription>
          </DialogHeader>
          <div className="schema-form">
            <Label htmlFor="schema-field-rename">이름</Label>
            <Input
              id="schema-field-rename"
              value={renameFieldName}
              onChange={(event) => setRenameFieldName(event.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter className="schema-dialog-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameFieldTarget(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={busy || !renameFieldName.trim()}
              onClick={() => {
                const target = renameFieldTarget;
                if (!target) return;
                void run(() =>
                  patchDataField(target.fieldId, {
                    displayName: renameFieldName.trim(),
                    expectedRevision: target.revision,
                    expectedSchemaRevision: schema.schemaRevision,
                    expectedProjectRevision: schema.projectRevision,
                  }),
                ).then((ok) => ok && setRenameFieldTarget(null));
              }}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTableTarget !== null}
        onOpenChange={(open) => !open && setDeleteTableTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>테이블 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              Draft에서 제거됩니다. 실제 행 삭제는 적용 계획에서 다시
              확인합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="schema-dialog-actions">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = deleteTableTarget;
                setDeleteTableTarget(null);
                if (target)
                  void run(() =>
                    deleteDataTable(target.id, {
                      expectedRevision: target.revision,
                      expectedSchemaRevision: schema.schemaRevision,
                      expectedProjectRevision: schema.projectRevision,
                    }),
                  );
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteFieldTarget !== null}
        onOpenChange={(open) => !open && setDeleteFieldTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>필드 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              Draft에서 제거됩니다. 데이터 영향은 적용 계획에 표시됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="schema-dialog-actions">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = deleteFieldTarget;
                setDeleteFieldTarget(null);
                if (target)
                  void run(() =>
                    deleteDataField(target.fieldId, {
                      expectedRevision: target.revision,
                      expectedSchemaRevision: schema.schemaRevision,
                      expectedProjectRevision: schema.projectRevision,
                    }),
                  );
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteRelationTarget !== null}
        onOpenChange={(open) => !open && setDeleteRelationTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>관계 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              Draft 관계를 제거합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="schema-dialog-actions">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = deleteRelationTarget;
                setDeleteRelationTarget(null);
                if (target)
                  void run(() =>
                    deleteDataRelation(target.id, {
                      expectedRevision: target.revision,
                      expectedSchemaRevision: schema.schemaRevision,
                      expectedProjectRevision: schema.projectRevision,
                    }),
                  );
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={migrationPlan !== null}
        onOpenChange={(open) => !open && setMigrationPlan(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Test DB 적용</AlertDialogTitle>
            <AlertDialogDescription>
              {migrationPlan?.impact.destructive
                ? `삭제 테이블 ${migrationPlan.impact.droppedTableCount} · 삭제 필드 ${migrationPlan.impact.droppedFieldCount} · 영향 행 ${migrationPlan.impact.affectedRowCount}`
                : `단계 ${migrationPlan?.steps.length ?? 0} · 백업 후 적용`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="schema-plan-steps">
            {migrationPlan?.steps.map((step) => (
              <span key={`${step.order}-${step.label}`}>
                {step.destructive ? (
                  <AlertTriangle aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                {step.label}
              </span>
            ))}
          </div>
          <AlertDialogFooter className="schema-dialog-actions">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void applyMigration()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              적용
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
