// 방명록 입력 검사 · api/guestbook.js와 시험(tests/guestbook.test.mjs)이 함께 씁니다.
// DB(supabase/guestbook.sql)의 CHECK 제약과 같은 규칙입니다. 서버에서 먼저 걸러 친절한 400을 돌려주고, DB는 마지막 방어선입니다.
//
//   이름 1~20자, 내용 1~200자 · 앞뒤 공백을 뺀 길이 · 글자 수는 코드포인트 기준(Postgres char_length와 같음)
//   줄바꿈·탭 같은 제어 문자는 받지 않습니다(한 줄 방명록)

export const NAME_MAX = 20;
export const MESSAGE_MAX = 200;

// 제어 문자(C0, DEL, C1)와 줄·문단 구분 문자
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;

// 글자 수: '😀'.length는 2지만 여기서는 1로 셉니다
export function countChars(text) {
  return [...text].length;
}

function checkField(value, { label, max, code }) {
  if (typeof value !== 'string') {
    return { error: { code, message: `${label}을(를) 글자로 보내 주세요.` } };
  }
  const text = value.trim();
  if (text === '') {
    return { error: { code, message: `${label}을(를) 입력해 주세요.` } };
  }
  if (CONTROL.test(text)) {
    return { error: { code, message: `${label}에는 줄바꿈이나 제어 문자를 넣을 수 없습니다.` } };
  }
  const length = countChars(text);
  if (length > max) {
    return { error: { code, message: `${label}은(는) ${max}자까지 쓸 수 있습니다. (지금 ${length}자)` } };
  }
  return { value: text };
}

// body: JSON.parse 결과(무엇이든 올 수 있음)
// 돌려주는 값: { ok: true, value: { name, message } } 또는 { ok: false, error: { code, message } }
export function validateEntry(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: { code: 'BAD_BODY', message: '{"name": "...", "message": "..."} 형태의 JSON으로 보내 주세요.' } };
  }
  const name = checkField(body.name, { label: '이름', max: NAME_MAX, code: 'BAD_NAME' });
  if (name.error) return { ok: false, error: name.error };
  const message = checkField(body.message, { label: '내용', max: MESSAGE_MAX, code: 'BAD_MESSAGE' });
  if (message.error) return { ok: false, error: message.error };
  return { ok: true, value: { name: name.value, message: message.value } };
}
