// 방명록 입력 검사 시험 · Supabase에는 연결하지 않습니다.
// 실행: 이 폴더에서  npm test   (또는  node --test)
//
// ① lib/guestbook.js의 validateEntry 경계값
// ② api/guestbook.js가 DB에 닿기 전에 잘못된 요청을 걸러 내는지(환경 변수 없이도 4xx가 나와야 함)
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry, countChars, NAME_MAX, MESSAGE_MAX } from '../lib/guestbook.js';
import handler from '../api/guestbook.js';

const ok = (name, message) => validateEntry({ name, message });

describe('validateEntry: 이름', () => {
  test('1자와 20자는 통과', () => {
    assert.equal(ok('가', '안녕').ok, true);
    assert.equal(ok('가'.repeat(NAME_MAX), '안녕').ok, true);
  });
  test('21자는 BAD_NAME', () => {
    const r = ok('가'.repeat(NAME_MAX + 1), '안녕');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'BAD_NAME');
  });
  test('빈 문자열·공백만은 BAD_NAME', () => {
    assert.equal(ok('', '안녕').error.code, 'BAD_NAME');
    assert.equal(ok('   ', '안녕').error.code, 'BAD_NAME');
    assert.equal(ok('　', '안녕').error.code, 'BAD_NAME'); // 전각 공백
  });
  test('문자열이 아니면 BAD_NAME', () => {
    for (const value of [undefined, null, 12, true, ['a'], { a: 1 }]) {
      assert.equal(ok(value, '안녕').error.code, 'BAD_NAME', String(value));
    }
  });
  test('앞뒤 공백은 지우고, 지운 뒤 길이로 센다', () => {
    const r = ok(`  ${'가'.repeat(NAME_MAX)}  `, '  안녕  ');
    assert.deepEqual(r, { ok: true, value: { name: '가'.repeat(NAME_MAX), message: '안녕' } });
  });
  test('이모지는 한 글자로 센다 (20개 통과, 21개 실패)', () => {
    assert.equal(countChars('😀'), 1);
    assert.equal(ok('😀'.repeat(NAME_MAX), '안녕').ok, true);
    assert.equal(ok('😀'.repeat(NAME_MAX + 1), '안녕').error.code, 'BAD_NAME');
  });
});

describe('validateEntry: 내용', () => {
  test('1자와 200자는 통과', () => {
    assert.equal(ok('소은', '!').ok, true);
    assert.equal(ok('소은', 'a'.repeat(MESSAGE_MAX)).ok, true);
  });
  test('201자는 BAD_MESSAGE', () => {
    assert.equal(ok('소은', 'a'.repeat(MESSAGE_MAX + 1)).error.code, 'BAD_MESSAGE');
  });
  test('빈 내용은 BAD_MESSAGE', () => {
    assert.equal(ok('소은', '').error.code, 'BAD_MESSAGE');
    assert.equal(ok('소은', ' \t ').error.code, 'BAD_MESSAGE');
  });
  test('줄바꿈·제어 문자는 BAD_MESSAGE (한 줄 방명록)', () => {
    for (const bad of ['첫 줄\n둘째 줄', 'a\rb', 'a\u0000b', 'a\u2028b']) {
      assert.equal(ok('소은', bad).error.code, 'BAD_MESSAGE', JSON.stringify(bad));
    }
  });
  test('HTML처럼 보이는 글자도 그대로 받는다(화면에서 글자로만 보여 줌)', () => {
    assert.deepEqual(ok('소은', '<b>hi</b>').value, { name: '소은', message: '<b>hi</b>' });
  });
});

describe('validateEntry: 본문 모양', () => {
  test('객체가 아니면 BAD_BODY', () => {
    for (const body of [null, undefined, 'text', 42, [], ['a', 'b']]) {
      assert.equal(validateEntry(body).error.code, 'BAD_BODY', JSON.stringify(body));
    }
  });
  test('이름을 먼저 검사한다', () => {
    assert.equal(validateEntry({}).error.code, 'BAD_NAME');
  });
  test('다른 필드는 무시하고 name, message만 돌려준다', () => {
    const r = validateEntry({ name: '소은', message: '안녕', id: 1, created_at: '2000-01-01' });
    assert.deepEqual(r.value, { name: '소은', message: '안녕' });
  });
});

describe('api/guestbook.js: DB에 닿기 전 거르기', () => {
  let fetchMock;
  beforeEach(() => {
    for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) delete process.env[k];
    fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('외부 호출이 일어나면 안 됩니다'); });
    mock.method(console, 'error', () => {});
  });
  afterEach(() => mock.restoreAll());

  const post = (body, type = 'application/json') => handler.fetch(new Request('http://localhost/api/guestbook', {
    method: 'POST', headers: { 'Content-Type': type }, body,
  }));

  test('잘못된 입력은 400과 코드를 돌려주고 외부 호출을 하지 않는다', async () => {
    const cases = [
      ['{"name":"","message":"안녕"}', 'BAD_NAME'],
      [JSON.stringify({ name: '가'.repeat(21), message: '안녕' }), 'BAD_NAME'],
      [JSON.stringify({ name: '소은', message: 'a'.repeat(201) }), 'BAD_MESSAGE'],
      ['[1,2]', 'BAD_BODY'],
      ['{"name":', 'BAD_JSON'],
    ];
    for (const [body, code] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, body);
      assert.equal((await res.json()).code, code, body);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test('JSON이 아니면 415', async () => {
    const res = await post('name=a&message=b', 'application/x-www-form-urlencoded');
    assert.equal(res.status, 415);
  });

  test('너무 큰 본문은 413', async () => {
    const res = await post(JSON.stringify({ name: 'a', message: 'b', pad: 'x'.repeat(5000) }));
    assert.equal(res.status, 413);
  });

  test('올바른 입력이어도 키가 없으면 500 NO_KEY (키 값은 응답에 없음)', async () => {
    const res = await post(JSON.stringify({ name: '소은', message: '안녕' }));
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.code, 'NO_KEY');
    assert.match(data.hint, /SUPABASE_URL, SUPABASE_SECRET_KEY/);
  });

  test('GET도 키가 없으면 500 NO_KEY', async () => {
    const res = await handler.fetch(new Request('http://localhost/api/guestbook'));
    assert.equal(res.status, 500);
    assert.match((await res.json()).hint, /SUPABASE_PUBLISHABLE_KEY/);
  });

  test('PUT·DELETE는 405', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await handler.fetch(new Request('http://localhost/api/guestbook', { method }));
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get('allow'), 'GET, HEAD, POST');
    }
  });
});
