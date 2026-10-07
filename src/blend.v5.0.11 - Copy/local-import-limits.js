export const LOCAL_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const LOCAL_IMPORT_MAX_ARRAY_ITEMS = 10_000;
export const LOCAL_IMPORT_MAX_TOTAL_ARRAY_ITEMS = 50_000;
export const LOCAL_IMPORT_MAX_OBJECT_PROPERTIES = 5_000;
export const LOCAL_IMPORT_MAX_TOTAL_OBJECT_PROPERTIES = 750_000;
export const LOCAL_IMPORT_MAX_NESTING_DEPTH = 64;
export const LOCAL_IMPORT_MAX_LINES = 100_000;
export const LOCAL_IMPORT_MAX_ENTRIES = 10_000;

export const LOCAL_IMPORT_SIZE_LIMIT_MESSAGE = 'This import exceeds the supported file size. Choose a smaller export file.';
export const LOCAL_IMPORT_STRUCTURE_LIMIT_MESSAGE = 'This import exceeds the supported structure limits. Choose a smaller or simpler export file.';

export class LocalImportLimitError extends Error {
  constructor(code) {
    super(code === 'file_size' ? LOCAL_IMPORT_SIZE_LIMIT_MESSAGE : LOCAL_IMPORT_STRUCTURE_LIMIT_MESSAGE);
    this.name = 'LocalImportLimitError';
    this.code = code === 'file_size' ? 'file_size' : 'structure_limit';
  }
}

export function assertLocalImportFileSize(file) {
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size < 0) throw new TypeError('Invalid import file size');
  if (size > LOCAL_IMPORT_MAX_BYTES) throw new LocalImportLimitError('file_size');
  return size;
}

export async function readLocalImportFile(file) {
  assertLocalImportFileSize(file);
  if (typeof file?.text !== 'function') throw new TypeError('Import file cannot be read');
  return file.text();
}

function failStructureLimit() {
  throw new LocalImportLimitError('structure_limit');
}

function addArrayItem(container, totals) {
  container.items += 1;
  totals.arrayItems += 1;
  if (container.items > LOCAL_IMPORT_MAX_ARRAY_ITEMS
      || totals.arrayItems > LOCAL_IMPORT_MAX_TOTAL_ARRAY_ITEMS) {
    failStructureLimit();
  }
}

function addObjectProperty(container, totals) {
  container.properties += 1;
  totals.objectProperties += 1;
  if (container.properties > LOCAL_IMPORT_MAX_OBJECT_PROPERTIES
      || totals.objectProperties > LOCAL_IMPORT_MAX_TOTAL_OBJECT_PROPERTIES) {
    failStructureLimit();
  }
}

/**
 * Scan JSON tokens before JSON.parse so excessive depth and array sizes are
 * rejected before the parsed object graph is created. JSON.parse remains the
 * authority for complete syntax validation.
 */
export function assertLocalImportJsonStructure(text) {
  if (typeof text !== 'string') throw new TypeError('Import JSON must be text');

  const stack = [];
  const totals = { arrayItems: 0, objectProperties: 0 };
  let inString = false;
  let escaped = false;

  const markValueOrProperty = () => {
    const parent = stack[stack.length - 1];
    if (!parent) return;
    if (parent.type === 'array') parent.hasItem = true;
    else parent.hasProperty = true;
  };

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      markValueOrProperty();
      inString = true;
      continue;
    }

    if (ch === '[' || ch === '{') {
      markValueOrProperty();
      if (stack.length >= LOCAL_IMPORT_MAX_NESTING_DEPTH) failStructureLimit();
      stack.push(ch === '['
        ? { type: 'array', items: 0, hasItem: false }
        : { type: 'object', properties: 0, hasProperty: false });
      continue;
    }

    if (ch === ',') {
      const current = stack[stack.length - 1];
      if (current?.type === 'array') {
        addArrayItem(current, totals);
        current.hasItem = false;
      } else if (current?.type === 'object') {
        addObjectProperty(current, totals);
        current.hasProperty = false;
      }
      continue;
    }

    if (ch === ']' || ch === '}') {
      const expectedType = ch === ']' ? 'array' : 'object';
      const current = stack[stack.length - 1];
      if (current?.type !== expectedType) continue;
      if (expectedType === 'array' && current.hasItem) addArrayItem(current, totals);
      if (expectedType === 'object' && current.hasProperty) addObjectProperty(current, totals);
      stack.pop();
      continue;
    }

    if (ch === ':' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    markValueOrProperty();
  }

  return totals;
}

/**
 * Defend parser entry points that receive an already-parsed value, while
 * avoiding recursion on attacker-controlled object graphs.
 */
export function assertLocalImportPayloadStructure(root) {
  const stack = [{ value: root, depth: 0 }];
  const totals = { arrayItems: 0, objectProperties: 0 };

  while (stack.length) {
    const { value, depth } = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (depth >= LOCAL_IMPORT_MAX_NESTING_DEPTH) failStructureLimit();

    if (Array.isArray(value)) {
      if (value.length > LOCAL_IMPORT_MAX_ARRAY_ITEMS) failStructureLimit();
      totals.arrayItems += value.length;
      if (totals.arrayItems > LOCAL_IMPORT_MAX_TOTAL_ARRAY_ITEMS) failStructureLimit();
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }

    let properties = 0;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      properties += 1;
      totals.objectProperties += 1;
      if (properties > LOCAL_IMPORT_MAX_OBJECT_PROPERTIES
          || totals.objectProperties > LOCAL_IMPORT_MAX_TOTAL_OBJECT_PROPERTIES) {
        failStructureLimit();
      }
      stack.push({ value: value[key], depth: depth + 1 });
    }
  }

  return totals;
}

export function parseBoundedImportJson(text) {
  assertLocalImportJsonStructure(text);
  const payload = JSON.parse(text);
  assertLocalImportPayloadStructure(payload);
  return payload;
}

export function assertLocalImportEntryCount(count) {
  if (!Number.isSafeInteger(count) || count < 0 || count > LOCAL_IMPORT_MAX_ENTRIES) {
    failStructureLimit();
  }
  return count;
}
