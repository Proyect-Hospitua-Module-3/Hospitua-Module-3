import { SetMetadata } from '@nestjs/common';
import { AppRole } from './authenticated-user';

export const ROLES_KEY = 'roles';

// @Roles('Administrador') / @Roles('OTA'): roles que pueden llamar al endpoint.
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
