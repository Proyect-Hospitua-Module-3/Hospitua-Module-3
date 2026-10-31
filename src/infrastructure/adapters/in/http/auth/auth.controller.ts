import { Body, Controller, HttpCode, Post, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, LoginResponseDto } from './dto/login.dto';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED: credenciales incorrectas o incompletas' })
  login(
    @Body(
      new ValidationPipe({
        exceptionFactory: () => new UnauthorizedException('Usuario o contraseña incorrectos.'),
      }),
    )
    body: LoginDto,
  ): Promise<LoginResponseDto> {
    return this.auth.login(body.username, body.password);
  }
}
