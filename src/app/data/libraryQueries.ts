import { queryClient } from './queryClient';
import { libraryKeys } from '../../features/content-library/api/libraryQueries';

export * from '../../features/content-library/api/libraryQueries';

export function invalidateLibraryQueries(): void {
  queryClient.invalidateQueries({ queryKey: libraryKeys.all });
}
