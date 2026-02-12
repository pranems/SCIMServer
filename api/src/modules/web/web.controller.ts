import { Controller, Get, Res, Param } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'node:path';
import { Public } from '../auth/public.decorator';

@Controller()
export class WebController {
  @Public()
  @Get('/')
  @Get('/admin')
  @Get('/admin/*path')
  serveWebApp(@Res() res: Response): void {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'index.html'));
  }

  @Public()
  @Get('/assets/*path')
  serveAssets(@Param('path') fileName: string, @Res() res: Response): void {
    const filePath = join(__dirname, '..', '..', '..', 'public', 'assets', fileName);
    res.sendFile(filePath);
  }
}