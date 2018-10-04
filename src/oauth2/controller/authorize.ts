import { Context, Middleware } from '@curveball/core';
import { BadRequest } from '@curveball/http-errors';
import querystring from 'querystring';
import BaseController from '../../base-controller';
import * as UserService from '../../user/service';
import { User } from '../../user/types';
import { loginForm } from '../formats/html';
import * as oauth2Service from '../service';
import { OAuth2Client } from '../types';
import { EventType } from '../../log/types';
import log from '../../log/service';

class AuthorizeController extends BaseController {

  async get(ctx: Context) {

    ctx.response.type = 'text/html';
    if (ctx.query.response_type !== 'token') {
      throw new BadRequest('The "response_type" parameter must be provided, and must be set to "token"');
    }
    if (!ctx.query.client_id) {
      throw new BadRequest('The "client_id" parameter must be provided');
    }
    if (!ctx.query.redirect_uri) {
      throw new BadRequest('The "redirect_uri" parameter must be provided');
    }
    const clientId = ctx.query.client_id;
    const state = ctx.query.state;
    // const scope = ctx.query.scope;
    const responseType = ctx.query.response_type;
    const redirectUri = ctx.query.redirect_uri;

    const oauth2Client = await oauth2Service.getClientByClientId(clientId);

    if (!await oauth2Service.validateRedirectUri(oauth2Client, redirectUri)) {
      log(EventType.oauth2BadRedirect, ctx);
      throw new BadRequest('This value for "redirect_uri" is not permitted.');
    }

    if (ctx.state.session.user !== undefined) {

      return this.loginAndRedirect(
        ctx,
        oauth2Client,
        redirectUri,
        state,
      );

    } else {
      ctx.response.body = loginForm(
        ctx.query.msg,
        {
          client_id: clientId,
          state: state,
          redirect_uri: redirectUri,
          response_type: responseType,
        },
      );
    }

  }

  async post(ctx: Context) {

    if (ctx.request.body.response_type !== 'token') {
      throw new BadRequest('The "response_type" parameter must be provided, and must be set to "token"');
    }
    if (!ctx.request.body.client_id) {
      throw new BadRequest('The "client_id" parameter must be provided');
    }
    if (!ctx.request.body.redirect_uri) {
      throw new BadRequest('The "redirect_uri" parameter must be provided');
    }
    const clientId = ctx.request.body.client_id;
    const state = ctx.request.body.state;
    const redirectUri = ctx.request.body.redirect_uri;
    const responseType = ctx.request.body.response_type;
    const oauth2Client = await oauth2Service.getClientByClientId(clientId);

    if (!await oauth2Service.validateRedirectUri(oauth2Client, redirectUri)) {
      log(EventType.oauth2BadRedirect, ctx);
      throw new BadRequest('This value for "redirect_uri" is not permitted.');
    }

    const params = {
      redirect_uri: redirectUri,
      client_id: clientId,
      state: state,
      response_type: responseType,
    };

    let user: User;
    try {
      user = await UserService.findByIdentity('mailto:' + ctx.request.body.username);
    } catch (err) {
      return this.redirectToLogin(ctx, { ...params, msg: 'Incorrect username or password' });
    }

    if (!await UserService.validatePassword(user, ctx.request.body.password)) {
      log(EventType.loginFailed, ctx.ip(), user.id);
      return this.redirectToLogin(ctx, { ...params, msg: 'Incorrect username or password'});
    }

    if (!await UserService.validateTotp(user, ctx.request.body.totp)) {
      log(EventType.totpFailed, ctx.ip(), user.id);
      return this.redirectToLogin(ctx, { ...params, msg: 'Incorrect TOTP code'});
    }

    ctx.state.session = {
      user: user,
    };
    log(EventType.loginSuccess, ctx);

    return this.loginAndRedirect(ctx, oauth2Client, params.redirect_uri, params.state);

  }

  async loginAndRedirect(ctx: Context, oauth2Client: OAuth2Client, redirectUri: string, state: string|undefined) {

    const token = await oauth2Service.getTokenForUser(
      oauth2Client,
      ctx.state.session.user
    );

    ctx.status = 302;
    ctx.response.headers.set('Cache-Control', 'no-cache');
    ctx.response.headers.set(
      'Location',
      redirectUri + '#' + querystring.stringify({
        access_token: token.accessToken,
        token_type: token.tokenType,
        expires_in: token.accessTokenExpires - Math.round(Date.now() / 1000),
        state: state
      })
    );

  }

  /**
   * Redirects to login screen, if login failed
   */
  async redirectToLogin(ctx: Context, params: { [key: string]: string }) {

    ctx.response.status = 302;
    ctx.response.headers.set('Location', '/authorize?' + querystring.stringify(params));

  }

}

function mw(): Middleware {
  const controller = new AuthorizeController();
  return controller.dispatch.bind(controller);
}

export default mw();