import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MEDIUMS = new Set(['flyer', 'banner', 'social', 'presentation', 'video', 'motion']);
const STATIC_MEDIA = new Set(['flyer', 'banner', 'social', 'presentation']);
const FORBIDDEN = /\b(trustless\s+ai|guaranteed\s+payout|fraud[- ]proof|risk[- ]free|zero[- ]risk|no[- ]loss|fully\s+autonomous)\b/i;

function issue(severity, path, message) { return { severity, path, message }; }

function type(value, expected) {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expected;
}

export function validateCreativeBrief(brief) {
  const errors = [];
  const warnings = [];
  const required = ['schemaVersion', 'id', 'medium', 'objective', 'audience', 'format', 'copy', 'visual', 'compliance', 'provenance', 'outputs'];
  for (const key of required) if (!(key in (brief ?? {}))) errors.push(issue('error', key, 'Required field is missing'));
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return { ok: false, errors: [issue('error', '$', 'Brief must be a JSON object')], warnings, checked: 0 };
  if (brief.schemaVersion !== '1.0') errors.push(issue('error', 'schemaVersion', 'Expected schema version 1.0'));
  if (brief.medium && !MEDIUMS.has(brief.medium)) errors.push(issue('error', 'medium', `Unsupported medium: ${brief.medium}`));
  for (const key of ['objective', 'audience']) if (brief[key] !== undefined && (!type(brief[key], 'string') || !brief[key].trim())) errors.push(issue('error', key, 'Must be a non-empty string'));
  const format = brief.format;
  if (format && type(format, 'object')) {
    for (const key of ['width', 'height']) if (!(Number.isFinite(format[key]) && format[key] > 0)) errors.push(issue('error', `format.${key}`, 'Must be a positive number'));
    if (!['px', 'mm', 'in'].includes(format.unit)) errors.push(issue('error', 'format.unit', 'Must be px, mm, or in'));
    if (!['portrait', 'landscape', 'square'].includes(format.orientation)) errors.push(issue('error', 'format.orientation', 'Must be portrait, landscape, or square'));
    if (brief.medium === 'flyer' && (!(format.dpi >= 300) || !(format.bleed >= 0))) errors.push(issue('error', 'format', 'Print flyers require dpi >= 300 and an explicit non-negative bleed'));
    if (['video', 'motion'].includes(brief.medium) && (!(format.durationSeconds > 0) || !(format.fps > 0))) errors.push(issue('error', 'format', 'Video and motion briefs require positive durationSeconds and fps'));
  } else errors.push(issue('error', 'format', 'Must be an object'));
  const copy = brief.copy;
  if (!copy || !type(copy, 'object')) errors.push(issue('error', 'copy', 'Must be an object'));
  else {
    for (const key of ['headline', 'cta']) if (!type(copy[key], 'string') || !copy[key].trim()) errors.push(issue('error', `copy.${key}`, 'Must be a non-empty string'));
    const rendered = ['headline', 'subhead', 'body', 'cta', 'disclaimers'].flatMap((key) => Array.isArray(copy[key]) ? copy[key] : [copy[key]]).filter((value) => typeof value === 'string').join('\n');
    if (FORBIDDEN.test(rendered)) errors.push(issue('error', 'copy', 'Contains a prohibited unqualified trust or financial guarantee claim'));
    if (!Array.isArray(copy.sourceClaims) || copy.sourceClaims.length === 0) errors.push(issue('error', 'copy.sourceClaims', 'Every factual creative needs at least one sourced claim'));
    else copy.sourceClaims.forEach((claim, index) => {
      if (!claim || typeof claim.claim !== 'string' || !claim.claim.trim()) errors.push(issue('error', `copy.sourceClaims[${index}].claim`, 'Claim text is required'));
      if (!claim || typeof claim.source !== 'string' || !claim.source.trim()) errors.push(issue('error', `copy.sourceClaims[${index}].source`, 'Claim source is required'));
    });
  }
  const visual = brief.visual;
  if (!visual || !type(visual, 'object')) errors.push(issue('error', 'visual', 'Must be an object'));
  else {
    if (!['official', 'text-only', 'none'].includes(visual.markUse)) errors.push(issue('error', 'visual.markUse', 'Must be official, text-only, or none'));
    if (!type(visual.typography, 'string') || !visual.typography.trim()) errors.push(issue('error', 'visual.typography', 'Typography direction is required'));
    if (!type(visual.palette, 'object')) errors.push(issue('error', 'visual.palette', 'Palette tokens are required'));
    if (visual.markUse === 'official' && brief.compliance?.assetRights !== 'confirmed') errors.push(issue('error', 'compliance.assetRights', 'Official ProofStream marks require confirmed redistribution rights'));
    if (visual.palette?.greenUsage && visual.palette.greenUsage !== 'released-usdc-only') errors.push(issue('error', 'visual.palette.greenUsage', 'The ProofStream green token is reserved for released USDC only'));
  }
  const compliance = brief.compliance;
  if (!compliance || !type(compliance, 'object')) errors.push(issue('error', 'compliance', 'Must be an object'));
  else {
    if (!Array.isArray(compliance.approvedClaims) || !Array.isArray(compliance.forbiddenClaims)) errors.push(issue('error', 'compliance', 'approvedClaims and forbiddenClaims must be arrays'));
    if (!['confirmed', 'pending', 'not-required'].includes(compliance.assetRights)) errors.push(issue('error', 'compliance.assetRights', 'Must be confirmed, pending, or not-required'));
    if (compliance.accessibility?.contrastChecked !== true) errors.push(issue('error', 'compliance.accessibility.contrastChecked', 'Contrast must be checked before export'));
    if (STATIC_MEDIA.has(brief.medium) && !(compliance.accessibility?.altText || visual?.altText)) errors.push(issue('error', 'compliance.accessibility.altText', 'Static creative requires alt text'));
    if (['video', 'motion'].includes(brief.medium) && (compliance.accessibility?.captions !== true || compliance.accessibility?.transcript !== true)) errors.push(issue('error', 'compliance.accessibility', 'Video and motion require captions and a transcript'));
  }
  if (!brief.provenance || !type(brief.provenance, 'object') || !brief.provenance.sourceCommit || !brief.provenance.briefOwner) errors.push(issue('error', 'provenance', 'sourceCommit and briefOwner are required'));
  if (!Array.isArray(brief.outputs) || brief.outputs.length === 0) errors.push(issue('error', 'outputs', 'At least one output is required'));
  else brief.outputs.forEach((output, index) => {
    if (!output || typeof output.filename !== 'string' || !output.filename.trim()) errors.push(issue('error', `outputs[${index}].filename`, 'Filename is required'));
    else if (output.filename.includes('..') || output.filename.includes('/') || output.filename.includes('\\')) errors.push(issue('error', `outputs[${index}].filename`, 'Filename must be a simple relative filename'));
    if (!output || !output.type) errors.push(issue('error', `outputs[${index}].type`, 'Output type is required'));
  });
  if (brief.medium === 'banner' && format?.orientation === 'portrait') warnings.push(issue('warning', 'format.orientation', 'Portrait banners may be better represented as social or story creative'));
  return { ok: errors.length === 0, errors, warnings, checked: required.length + (Array.isArray(brief.outputs) ? brief.outputs.length : 0) };
}

export async function creativeCheck(file, { json = false } = {}) {
  if (!file) throw new Error('Usage: proofstream-skill creative-check <brief.json> [--json]');
  const path = resolve(file);
  let brief;
  try { brief = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { return { ok: false, errors: [issue('error', '$', `Cannot read JSON brief: ${error.message}`)], warnings: [], checked: 0, file: path }; }
  return { ...validateCreativeBrief(brief), file: path, json };
}
