import { UNTRUSTED_CONTENT_NOTICE } from '../../../security/src/untrusted.js';
import { looksLikeCommandResult, shapeCommandValue } from './command-output.js';
import { isRecord, unwrapOk, type Json } from './common.js';

export function isBatchResult(value: unknown): value is Json {
  return (
    isRecord(value) &&
    Array.isArray(value.results) &&
    typeof value.count === 'number' &&
    typeof value.succeeded === 'number'
  );
}

function shapeItem(item: unknown, budget: number): { item: unknown; hoisted: boolean } {
  if (!isRecord(item)) return { item, hoisted: false };
  const { index: _index, ...rest } = item;
  let hoisted = false;
  if (isRecord(rest.value)) {
    let value: Json = rest.value;
    const inner = unwrapOk(value);
    if (isRecord(inner) && looksLikeCommandResult(inner)) {
      value = shapeCommandValue(inner, budget);
    } else {
      value = { ...value };
      if (value.path !== undefined && value.path === rest.path) delete value.path;
      if (value.sensitivity === 'NORMAL') delete value.sensitivity;
      if (value.untrusted === true && value.notice === UNTRUSTED_CONTENT_NOTICE) {
        delete value.untrusted;
        delete value.notice;
        hoisted = true;
      }
    }
    rest.value = value;
  }
  return { item: rest, hoisted };
}

/** Compacts a batch envelope. Never touches file `content`. */
export function shapeBatchResult(data: Json, budget: number): Json {
  const shaped: Json = { ...data };
  if (shaped.failed === 0) delete shaped.failed;
  if (shaped.skipped === 0) delete shaped.skipped;
  let anyHoisted = false;
  shaped.results = (data.results as unknown[]).map((entry) => {
    const { item, hoisted } = shapeItem(entry, budget);
    anyHoisted ||= hoisted;
    return item;
  });
  if (anyHoisted) {
    shaped.untrusted = true;
    shaped.notice = UNTRUSTED_CONTENT_NOTICE;
  }
  return shaped;
}
