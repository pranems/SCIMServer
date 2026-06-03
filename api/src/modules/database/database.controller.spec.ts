import { DatabaseController } from './database.controller';

describe('DatabaseController', () => {
  let controller: DatabaseController;
  let mockDatabaseService: any;

  beforeEach(() => {
    mockDatabaseService = {
      getUsers: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
      getGroups: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
      getUserDetails: jest.fn().mockResolvedValue({ id: 'u1', userName: 'test' }),
      getGroupDetails: jest.fn().mockResolvedValue({ id: 'g1', displayName: 'group' }),
      getStatistics: jest.fn().mockResolvedValue({ users: 10, groups: 5 }),
    };

    controller = new DatabaseController(mockDatabaseService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getUsers', () => {
    it('should call databaseService.getUsers with default pagination', async () => {
      await controller.getUsers();
      expect(mockDatabaseService.getUsers).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        search: undefined,
        active: undefined,
      });
    });

    it('should pass custom page and limit', async () => {
      await controller.getUsers('2', '25');
      expect(mockDatabaseService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 25 }),
      );
    });

    it('should pass search filter', async () => {
      await controller.getUsers('1', '50', 'john');
      expect(mockDatabaseService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'john' }),
      );
    });

    it('should parse active filter as boolean', async () => {
      await controller.getUsers('1', '50', undefined, 'true');
      expect(mockDatabaseService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ active: true }),
      );
    });

    it('should parse active=false correctly', async () => {
      await controller.getUsers('1', '50', undefined, 'false');
      expect(mockDatabaseService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ active: false }),
      );
    });
  });

  describe('getGroups', () => {
    it('should call databaseService.getGroups with default pagination', async () => {
      await controller.getGroups();
      expect(mockDatabaseService.getGroups).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        search: undefined,
      });
    });

    it('should pass custom page and limit', async () => {
      await controller.getGroups('3', '10');
      expect(mockDatabaseService.getGroups).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, limit: 10 }),
      );
    });

    it('should pass search filter', async () => {
      await controller.getGroups('1', '50', 'eng');
      expect(mockDatabaseService.getGroups).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'eng' }),
      );
    });
  });

  describe('getUserDetails', () => {
    it('should call databaseService.getUserDetails with id', async () => {
      await controller.getUserDetails('user-123');
      expect(mockDatabaseService.getUserDetails).toHaveBeenCalledWith('user-123');
    });

    it('should return user details', async () => {
      const result = await controller.getUserDetails('u1');
      expect(result).toEqual({ id: 'u1', userName: 'test' });
    });
  });

  describe('getGroupDetails', () => {
    it('should call databaseService.getGroupDetails with id', async () => {
      await controller.getGroupDetails('group-456');
      expect(mockDatabaseService.getGroupDetails).toHaveBeenCalledWith('group-456');
    });

    it('should return group details', async () => {
      const result = await controller.getGroupDetails('g1');
      expect(result).toEqual({ id: 'g1', displayName: 'group' });
    });
  });

  describe('getStatistics', () => {
    it('should return database statistics', async () => {
      const result = await controller.getStatistics();
      expect(result).toEqual({ users: 10, groups: 5 });
    });

    it('should call databaseService.getStatistics', async () => {
      await controller.getStatistics();
      expect(mockDatabaseService.getStatistics).toHaveBeenCalled();
    });
  });
});
