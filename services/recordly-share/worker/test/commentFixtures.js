import { env } from 'cloudflare:test';
import { ensureSchema } from '../src/schema.js';
import { sha256Hex } from '../src/crypto.js';
export async function localCommentHeaders(displayName = 'Signed-in Reviewer') {
  await ensureSchema(env);
  const token = crypto.randomUUID();
  const result = await env.DB.prepare("INSERT INTO comment_users(email,display_name,password_hash,password_salt) VALUES (?,?,'unused','unused')")
    .bind(`${token}@example.test`, displayName).run();
  await env.DB.prepare("INSERT INTO comment_sessions(token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+1 day'))")
    .bind(await sha256Hex(token),result.meta.last_row_id).run();
  return { Cookie: `recordly_comment_session=${token}` };
}
