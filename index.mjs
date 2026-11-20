import { createMemoryClient } from './lib/client.mjs';
import { definitions } from './lib/contracts.mjs';
import { skillBody } from './lib/skill.mjs';
import { Type } from '@sinclair/typebox';

const read = Object.freeze({ isReadOnly: true, isDestructive: false, isConcurrencySafe: true, isOpenWorld: false, replay: 'safe', requiresApproval: 'never' });
const write = Object.freeze({ isReadOnly: false, isDestructive: true, isConcurrencySafe: false, isOpenWorld: false, replay: 'never', requiresApproval: 'always' });

function nativeSchema(schema) {
  const properties = {};
  for (const [key, rule] of Object.entries(schema.properties)) {
    let field;
    if (rule.enum) field = Type.Union(rule.enum.map(value => Type.Literal(value)));
    else if (rule.type === 'string') field = Type.String(rule);
    else if (rule.type === 'integer') field = Type.Integer(rule);
    else field = Type.Boolean();
    properties[key] = schema.required.includes(key) ? field : Type.Optional(field);
  }
  return Type.Object(properties, { additionalProperties: false });
}

// Standard Cordis/AGH plugin object. TypeBox is supplied by the AGH Host.
export const main = {
  apply(ctx, config = {}) {
    const client = createMemoryClient(config);
    for (const definition of definitions) {
      if (definition.name === 'bm_write' && !client.allowWrites) continue;
      ctx.tools.register({
        name: definition.nativeName,
        description: definition.description,
        parameters: nativeSchema(definition.inputSchema),
        meta: definition.name === 'bm_write' ? write : read,
        async execute(args, toolContext) {
          try {
            const result = await client.call(definition.name, args, { signal: toolContext.signal, timeoutMs: toolContext.timeoutMs });
            return { content: result.content, ...(result.isError ? { isError: true } : {}), ...(result.structuredContent && !result.isError ? { structured: result.structuredContent } : {}) };
          } catch (error) {
            if (toolContext.signal.aborted || error.name === 'AbortError') throw error;
            return { isError: true, content: [{ type: 'text', text: error.message }] };
          }
        },
      });
    }
    ctx.skills.register({ name: 'shared-engineering-memory', description: 'Retrieve original engineering knowledge, resolve corrections and verify durable saves in the existing shared memory service.', body: skillBody });
  },
};
