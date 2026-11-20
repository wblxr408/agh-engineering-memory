const string = (maxLength = 2048) => ({ type: 'string', minLength: 1, maxLength });
const boolean = { type: 'boolean' };
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const definitions = [
  {
    name: 'bm_search', nativeName: 'engineering_memory_search',
    description: 'Search the configured shared knowledge project. Start with text; read selected sources before relying on excerpts. Include history for corrections or historical evidence.',
    inputSchema: object({ query: string(), mode: { enum: ['text', 'hybrid', 'semantic', 'title', 'permalink'] }, include_history: boolean, scope: string(), page: integer(1, 100000), page_size: integer(1, 100) }, ['query']),
  },
  {
    name: 'bm_read', nativeName: 'engineering_memory_read',
    description: 'Read the exact original note in the configured project, with optional heading or line range. Preserve citations, dates, corrections and exact wording.',
    inputSchema: object({ identifier: string(), section: string(), start_line: integer(1, 10000000), end_line: integer(1, 10000000), max_tokens: integer(1, 100000), include_history: boolean, scope: string() }, ['identifier']),
  },
  {
    name: 'bm_write', nativeName: 'engineering_memory_save',
    description: 'Create a new Markdown note in the configured shared project. Existing notes cannot be overwritten. A queued receipt is not a confirmed save; query write status and read back the note.',
    inputSchema: object({ identifier: string(), content: string(800000), title: string(200) }, ['identifier', 'content']),
  },
  {
    name: 'memory_write_status', nativeName: 'engineering_memory_write_status',
    description: 'Read the durable result of one save by write_id. queued/confirming is not saved; failed or unknown remains unresolved. Read back the note after saved.',
    inputSchema: object({ write_id: string(256) }, ['write_id']),
  },
];

export function validateArguments(definition, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Tool arguments must be an object');
  const schema = definition.inputSchema;
  for (const key of schema.required) if (!Object.hasOwn(args, key)) throw new TypeError(`Missing argument: ${key}`);
  for (const [key, value] of Object.entries(args)) {
    if (!Object.hasOwn(schema.properties, key)) throw new TypeError('Unsupported argument');
    const rule = schema.properties[key];
    if (rule.enum && !rule.enum.includes(value)) throw new TypeError(`Invalid argument: ${key}`);
    if (rule.type === 'string' && (typeof value !== 'string' || !value.trim() || value.length < rule.minLength || value.length > rule.maxLength)) throw new TypeError(`Invalid argument: ${key}`);
    if (rule.type === 'boolean' && typeof value !== 'boolean') throw new TypeError(`Invalid argument: ${key}`);
    if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)) throw new TypeError(`Invalid argument: ${key}`);
  }
  if (args.start_line && args.end_line && args.start_line > args.end_line) throw new TypeError('start_line must not exceed end_line');
}
