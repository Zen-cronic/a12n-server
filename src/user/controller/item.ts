import Controller from '@curveball/controller';
import { Context } from '@curveball/core';
import * as privilegeService from '../../privilege/service.js';
import * as userHal from '../formats/hal.js';
import * as userService from '../service.js';
import { PrincipalService } from '../../principal/service.js';
import * as principalIdentityService from '../../principal-identity/service.js';
import { PrincipalEdit } from '../../api-types.js';

class UserController extends Controller {

  async get(ctx: Context) {

    const principalService = new PrincipalService(ctx.privileges);
    const principal = await principalService.findByExternalId(ctx.params.id, 'user');

    let hasControl = false;
    let hasPassword = false;
    const isAdmin = ctx.privileges.has('admin');

    if (ctx.auth.equals(principal)) {
      hasControl = true;
    } else if (isAdmin) {
      hasControl = true;
    }

    if (hasControl && principal.type === 'user') {
      hasPassword = await userService.hasPassword(principal);
    }

    const principalPrivileges = await privilegeService.get(principal);

    const currentUserPrivileges = ctx.privileges;

    ctx.response.body = userHal.item(
      principal,
      principalPrivileges.getAll(),
      hasControl,
      hasPassword,
      currentUserPrivileges,
      await principalService.findGroupsForPrincipal(principal),
      await principalIdentityService.findByPrincipal(principal),
    );

  }

  async put(ctx: Context) {

    ctx.request.validate<PrincipalEdit>(
      'https://curveballjs.org/schemas/a12nserver/principal-edit.json'
    );
    const principalService = new PrincipalService(ctx.privileges);

    const user = await principalService.findByExternalId(ctx.params.id);
    user.active = !!ctx.request.body.active;
    user.nickname = ctx.request.body.nickname;

    await principalService.save(user);
    ctx.status = 204;

  }
}

export default new UserController();
