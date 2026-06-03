import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'node:path';
import { Public } from '../auth/public.decorator';

@Controller()
export class WebController {
  @Public()
  @Get('/')
  serveWebApp(@Res() res: Response): void {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'index.html'));
  }
}