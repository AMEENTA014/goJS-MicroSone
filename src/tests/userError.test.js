import request from 'supertest';
import { app } from '../server.mjs';

describe('User API error handling', () => {
  it('returns 400 for missing fields', async () => {
    const resp = await request(app)
      .post('/users')
      .send({ name: 'Test' }) // missing userId and email
      .expect(400);
    expect(resp.body.error).toBe('Missing fields');
  });
});
