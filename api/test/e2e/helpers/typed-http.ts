import type { Response, Test } from 'supertest';

export type TypedHttpResponse<Body extends object> = Omit<Response, 'body'> & { body: Body };

export type TypedHttpTest<Body extends object> =
  Omit<Test, 'then' | 'expect'> &
  PromiseLike<TypedHttpResponse<Body>> & {
    expect(status: number | ((response: TypedHttpResponse<Body>) => void)): TypedHttpTest<Body>;
  };
