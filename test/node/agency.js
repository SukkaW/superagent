'use strict';

require('should-http');

let http = require('node:http');
const assert = require('node:assert');
const should = require('should');
const cookieParser = require('cookie-parser');
const cookiejar = require('cookiejar');
const session = require('express-session');
const request = require('../support/client');
const express = require('../support/express');

const app = express();

if (process.env.HTTP2_TEST) {
  http = require('node:http2');
  http.Http2ServerResponse.prototype._implicitHeader = function () {
    this.writeHead(this.statusCode);
  };
}

app.use(cookieParser());
app.use(
  session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
  })
);

app.post('/signin', (request_, res) => {
  request_.session.user = 'hunter@hunterloftis.com';
  res.redirect('/dashboard');
});

app.post('/setcookie', (request_, res) => {
  res.cookie('cookie', 'jar');
  res.sendStatus(200);
});

app.get('/getcookie', (request_, res) => {
  res.status(200).send(request_.cookies.cookie);
});

app.get('/cookieheader', (request_, res) => {
  res.status(200).send(request_.headers.cookie);
});

app.get('/dashboard', (request_, res) => {
  if (request_.session.user) return res.status(200).send('dashboard');
  res.status(401).send('dashboard');
});

app.all('/signout', (request_, res) => {
  request_.session.regenerate(() => {
    res.status(200).send('signout');
  });
});

app.get('/', (request_, res) => {
  if (request_.session.user) return res.redirect('/dashboard');
  res.status(200).send('home');
});

app.post('/redirect', (request_, res) => {
  res.redirect('/simple');
});

app.get('/simple', (request_, res) => {
  res.status(200).send('simple');
});

let base = 'http://localhost';
let server;
before(function listen(done) {
  server = http.createServer(app);
  server = server.listen(0, function listening() {
    base += `:${server.address().port}`;
    done();
  });
});

describe('request', () => {
  describe('persistent agent', () => {
    const agent1 = request.agent();
    const agent2 = request.agent();
    const agent3 = request.agent();
    const agent4 = request.agent();

    it('should gain a session on POST', () =>
      agent3.post(`${base}/signin`).then((res) => {
        res.should.have.status(200);
        should.not.exist(res.headers['set-cookie']);
        res.text.should.containEql('dashboard');
      }));

    it('should start with empty session (set cookies)', (done) => {
      agent1.get(`${base}/dashboard`).end((error, res) => {
        should.exist(error);
        res.should.have.status(401);
        should.exist(res.headers['set-cookie']);
        done();
      });
    });

    it('should gain a session (cookies already set)', () =>
      agent1.post(`${base}/signin`).then((res) => {
        res.should.have.status(200);
        should.not.exist(res.headers['set-cookie']);
        res.text.should.containEql('dashboard');
      }));

    it('should persist cookies across requests', () =>
      agent1.get(`${base}/dashboard`).then((res) => {
        res.should.have.status(200);
      }));

    it('should have the cookie set in the end callback', () =>
      agent4
        .post(`${base}/setcookie`)
        .then(() => agent4.get(`${base}/getcookie`))
        .then((res) => {
          res.should.have.status(200);
          assert.strictEqual(res.text, 'jar');
        }));

    it('should produce a valid cookie header', (done) => {
      agent4
        .set('Cookie', 'first_cookie=dummy; cookie=jam')
        .get(`${base}/cookieheader`)
        .then((res) => {
          const cookiePairs = res.text.split('; '); // https://httpwg.org/specs/rfc6265.html#rfc.section.4.2.1
          assert.deepStrictEqual(cookiePairs, [
            'first_cookie=dummy',
            'cookie=jar',
            `connect.sid=${
              agent4.jar.getCookie(
                'connect.sid',
                cookiejar.CookieAccessInfo.All
              ).value
            }`
          ]);
          done();
        });
    });

    it('should not share cookies between domains', () => {
      assert.equal(agent4.get('https://google.com').cookies, '');
    });

    it('should send cookies to allowed domain with a different path', () => {
      const postRequest = agent4.post(`${base}/x/y/z`);
      const cookiesNames = postRequest.cookies
        .split(';')
        .map((cookie) => cookie.split('=')[0]);
      cookiesNames.should.eql(['cookie', ' connect.sid']);
    });

    it('should not share cookies', (done) => {
      agent2.get(`${base}/dashboard`).end((error, res) => {
        should.exist(error);
        res.should.have.status(401);
        done();
      });
    });

    it('should not lose cookies between agents', () =>
      agent1.get(`${base}/dashboard`).then((res) => {
        res.should.have.status(200);
      }));

    it('should be able to follow redirects', () =>
      agent1.get(base).then((res) => {
        res.should.have.status(200);
        res.text.should.containEql('dashboard');
      }));

    it('should be able to post redirects', () =>
      agent1
        .post(`${base}/redirect`)
        .send({ foo: 'bar', baz: 'blaaah' })
        .then((res) => {
          res.should.have.status(200);
          res.text.should.containEql('simple');
          res.redirects.should.eql([`${base}/simple`]);
        }));

    it('should be able to limit redirects', (done) => {
      agent1
        .get(base)
        .redirects(0)
        .end((error, res) => {
          should.exist(error);
          res.should.have.status(302);
          res.redirects.should.eql([]);
          res.header.location.should.equal('/dashboard');
          done();
        });
    });

    it('should be able to create a new session (clear cookie)', () =>
      agent1.post(`${base}/signout`).then((res) => {
        res.should.have.status(200);
        should.exist(res.headers['set-cookie']);
      }));

    it('should regenerate with an empty session', (done) => {
      agent1.get(`${base}/dashboard`).end((error, res) => {
        should.exist(error);
        res.should.have.status(401);
        should.not.exist(res.headers['set-cookie']);
        done();
      });
    });
  });
});
