// 한 줄 방명록 Vercel 함수 · Supabase의 public.guestbook 표를 읽고 씁니다.
//
//   GET  /api/guestbook   최근 20개 (새 글이 위)
//   POST /api/guestbook   {"name": "...", "message": "..."}  → 입력 검사 뒤 저장, 201
//
// 키는 Vercel 환경 변수에서만 읽습니다(코드·저장소·로그·응답에는 적지 않습니다)
//   SUPABASE_URL              프로젝트 주소
//   SUPABASE_PUBLISHABLE_KEY  읽기용. 공개 역할(anon)이라 RLS 정책(누구나 읽기만)이 그대로 적용됩니다
//   SUPABASE_SECRET_KEY       저장용. service_role이라 RLS를 건너뛰므로 이 함수 안에서만 씁니다
//                             DB 권한은 select, insert만 받았습니다(supabase/guestbook.sql)
import { createClient } from '@supabase/supabase-js';
import { validateEntry } from '../lib/guestbook.js';

const TABLE = 'guestbook';
const LIMIT = 20;
const MAX_BODY_BYTES = 4096; // 이름 20자 + 내용 200자면 넉넉합니다
const COLUMNS = 'id, name, message, created_at';

export default {
  async fetch(request) {
    if (request.method === 'GET' || request.method === 'HEAD') return list();
    if (request.method === 'POST') return create(request);
    return fail(405, 'METHOD', '이 주소는 GET과 POST 요청만 받습니다.', {}, { Allow: 'GET, HEAD, POST' });
  },
};

async function list() {
  const db = connect('SUPABASE_PUBLISHABLE_KEY');
  if (db.error) return db.error;

  const { data, error } = await db.client
    .from(TABLE)
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIMIT);
  if (error) return dbError('읽기', error);

  return Response.json({ count: data.length, items: data }, { headers: { 'Cache-Control': 'no-store' } });
}

async function create(request) {
  // ① 본문 읽기: JSON만 받습니다(다른 사이트의 <form>이 몰래 글을 올리지 못하게)
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) {
    return fail(415, 'BAD_TYPE', 'Content-Type: application/json 으로 보내 주세요.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return fail(413, 'TOO_LARGE', '보낸 내용이 너무 큽니다.');
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'BAD_JSON', 'JSON 형식이 올바르지 않습니다.');
  }

  // ② 입력 검사: DB에 닿기 전에 걸러 냅니다
  const checked = validateEntry(body);
  if (!checked.ok) return fail(400, checked.error.code, checked.error.message);

  // ③ 저장: secret 키로 넣고, 넣은 행을 돌려받습니다
  const db = connect('SUPABASE_SECRET_KEY');
  if (db.error) return db.error;

  const { data, error } = await db.client.from(TABLE).insert(checked.value).select(COLUMNS).single();
  if (error) {
    if (error.code === '23514') { // CHECK 제약 위반: 서버 검사를 통과했는데 DB 규칙에 걸린 경우
      return fail(400, 'REJECTED', '방명록 규칙(이름 1~20자, 내용 1~200자)에 맞지 않습니다.');
    }
    return dbError('저장', error);
  }
  return Response.json({ item: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}

// 요청마다 환경 변수를 읽어 클라이언트를 만듭니다(로그인 세션은 쓰지 않음)
function connect(keyName) {
  const url = String(process.env.SUPABASE_URL ?? '').trim();
  const key = String(process.env[keyName] ?? '').trim();
  const missing = [!url && 'SUPABASE_URL', !key && keyName].filter(Boolean);
  if (missing.length) {
    console.error(`[guestbook] 환경 변수가 없습니다: ${missing.join(', ')}`);
    return {
      error: fail(500, 'NO_KEY', '서버에 Supabase 설정이 되어 있지 않습니다.', {
        hint: `Vercel 프로젝트 Settings → Environment Variables에 ${missing.join(', ')}을(를) 추가한 뒤 다시 배포합니다.`,
      }),
    };
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client };
}

// DB 오류는 코드와 메시지만 로그에 남기고, 사용자에게는 짧게 알립니다
function dbError(action, error) {
  console.error(`[guestbook] ${action} 실패 code=${error.code ?? '-'} ${error.message ?? ''}`);
  return fail(502, 'DB_ERROR', `방명록을 ${action === '읽기' ? '불러오지' : '저장하지'} 못했습니다. 잠시 뒤 다시 시도해 주세요.`);
}

function fail(status, code, message, extra = {}, headers = {}) {
  return Response.json({ error: message, code, ...extra }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
