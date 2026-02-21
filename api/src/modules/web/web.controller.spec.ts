import { WebController } from './web.controller';

describe('WebController', () => {
  let controller: WebController;

  beforeEach(() => {
    controller = new WebController();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('serveWebApp', () => {
    it('should call res.sendFile with index.html', () => {
      const mockRes = { sendFile: jest.fn() } as any;
      controller.serveWebApp(mockRes);
      expect(mockRes.sendFile).toHaveBeenCalledTimes(1);
      const filePath: string = mockRes.sendFile.mock.calls[0][0];
      expect(filePath).toContain('index.html');
      expect(filePath).toContain('public');
    });
  });

  describe('serveAssets', () => {
    it('should call res.sendFile with the requested asset path', () => {
      const mockRes = { sendFile: jest.fn() } as any;
      controller.serveAssets('logo.png', mockRes);
      expect(mockRes.sendFile).toHaveBeenCalledTimes(1);
      const filePath: string = mockRes.sendFile.mock.calls[0][0];
      expect(filePath).toContain('logo.png');
      expect(filePath).toContain('assets');
    });
  });
});
