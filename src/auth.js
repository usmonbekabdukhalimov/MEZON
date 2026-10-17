import {assert, HttpError} from './validation.js';
import {accessToken} from './accounts.js';

export async function verifySupabase(request, env) {
  const authorization = request.headers.get('Authorization') || (accessToken(request)?'Bearer '+accessToken(request):null);
  assert(authorization?.startsWith('Bearer ') && authorization.length < 8192, 'Hisobga kiring.', 401);
  assert(env.SUPABASE_URL?.startsWith('https://') && env.SUPABASE_PUBLISHABLE_KEY, 'Supabase sozlanmagan.', 503);
  let response;
  try {
    response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: {Authorization: authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY},
      signal: AbortSignal.timeout(10000)
    });
  } catch { throw new HttpError(503, 'Kirish xizmatiga ulanib bo‘lmadi.'); }
  assert(response.status !== 429 && response.status < 500, 'Kirish xizmati vaqtincha band.', 503);
  assert(response.ok, 'Sessiya yaroqsiz. Qayta kiring.', 401);
  const user = await response.json();
  assert(typeof user.id === 'string' && !user.is_anonymous, 'Shaxsiy hisob talab qilinadi.', 401);
  return user.id;
}

export async function authorize(request, env, verify = verifySupabase) {
  const id = await verify(request, env);
  const actor = await env.DB.prepare('SELECT id,role,agent_id FROM users WHERE id=? AND active=1').bind(id).first();
  assert(actor, 'Hisobga MEZON ruxsati berilmagan.', 403);
  return actor;
}
