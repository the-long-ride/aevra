import https from 'node:https';

export function loginCookie(base: string, username: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      `${base}/api/auth/login`,
      {
        method: 'POST',
        rejectUnauthorized: false,
        headers: { 'content-type': 'application/json', origin: base },
      },
      (response) => {
        response.resume();
        response.once('end', () => {
          const cookie = response.headers['set-cookie']
            ?.find((value) => value.startsWith('aevra_admin='))
            ?.split(';')[0];
          if (!cookie || response.statusCode !== 200)
            reject(new Error(`Admin fixture login failed: ${response.statusCode}`));
          else resolve(cookie);
        });
      },
    );
    request.once('error', reject);
    request.end(JSON.stringify({ username, password }));
  });
}
