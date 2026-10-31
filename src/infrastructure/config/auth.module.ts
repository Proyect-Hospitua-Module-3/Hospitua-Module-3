import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from '../adapters/in/http/auth/auth.controller';
import { AuthService } from '../adapters/in/http/auth/auth.service';
import { JwtAuthGuard } from '../adapters/in/http/auth/jwt-auth.guard';
import { JwtStrategy } from '../adapters/in/http/auth/jwt.strategy';
import { RolesGuard } from '../adapters/in/http/auth/roles.guard';

@Module({
  imports: [
    PassportModule,
    // El secreto se carga del entorno y nunca se versiona.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: Number(config.getOrThrow<string>('JWT_EXPIRES_IN_SECONDS')) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
