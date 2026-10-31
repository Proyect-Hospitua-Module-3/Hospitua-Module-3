import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../out/persistence/prisma.service';
import { AuthenticatedUser } from './authenticated-user';

// Login propio de Módulo 3: verifica bcrypt contra `app_user` y firma el JWT.
// Es un aspecto técnico transversal, no un bounded context (plan base).
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(username: string, password: string): Promise<{ accessToken: string; expiresIn: number }> {
    const user = await this.prisma.appUser.findUnique({ where: { username } });
    const valid = user?.active === true && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !valid) {
      // Mismo mensaje exista o no el usuario, para no revelar cuáles existen.
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    }

    const claims: AuthenticatedUser = {
      sub: user.id,
      role: user.role,
      ...(user.otaId ? { otaId: user.otaId } : {}),
    };
    return {
      accessToken: await this.jwt.signAsync(claims),
      expiresIn: Number(this.config.getOrThrow<string>('JWT_EXPIRES_IN_SECONDS')),
    };
  }
}
