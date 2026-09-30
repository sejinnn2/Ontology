import type { OntologyApp } from "@/lib/app-state";
import { tableByName, type ColumnRef } from "@/lib/mock-data";

// Shared by the editing views: whether a Property may be mapped to a Column (their
// data types must be in the same family), and mapping it only when it may.

export function dataTypeFamily(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (["int", "integer", "numeric", "decimal", "number", "float", "double"].includes(normalized)) {
    return "number";
  }
  if (["string", "text", "varchar", "char"].includes(normalized)) return "text";
  if (["bool", "boolean"].includes(normalized)) return "boolean";
  if (["date", "datetime", "timestamp"].includes(normalized)) return "date";
  return normalized;
}

export function canMapPropertyToColumn(
  app: OntologyApp,
  entityId: string,
  propertyId: string,
  mapping: ColumnRef,
): boolean {
  const entity = app.entities.find((candidate) => candidate.id === entityId);
  const property = entity?.properties.find((candidate) => candidate.id === propertyId);
  const column = tableByName(mapping.table)?.columns.find(
    (candidate) => candidate.name === mapping.column,
  );
  if (!property || !column) return false;
  if (dataTypeFamily(property.type) !== dataTypeFamily(column.type)) return false;
  return true;
}

export function tryUpdatePropertyMapping(
  app: OntologyApp,
  entityId: string,
  propertyId: string,
  mapping: ColumnRef,
): boolean {
  if (!canMapPropertyToColumn(app, entityId, propertyId, mapping)) return false;
  app.updateMapping(entityId, propertyId, mapping);
  return true;
}
