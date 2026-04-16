/**
 * Utility types for common patterns across the application
 * These types help avoid `any` and provide better type safety
 */

/**
 * Represents the result of an async operation that can be in different states
 */
export type AsyncResult<T, E = Error> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: E };

/**
 * Represents a paginated API response
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Represents a standard API response with optional data and error
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  metadata?: {
    timestamp: string;
    requestId?: string;
  };
}

/**
 * Makes all properties in T optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Makes all properties in T required recursively
 */
export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};

/**
 * Extracts the type of a Promise's resolve value
 */
export type PromiseValue<T> = T extends Promise<infer U> ? U : T;

/**
 * Creates a type that requires at least one of the properties in T
 */
export type AtLeastOne<T, U = { [K in keyof T]?: never }> = Partial<T> & U & Record<never, never>;

/**
 * Creates a type that makes specific keys required
 */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Creates a type that makes specific keys optional
 */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Represents a value that can be loaded asynchronously
 */
export type AsyncValue<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
};

/**
 * Represents a form field state
 */
export interface FormField<T = unknown> {
  value: T;
  error: string | null;
  touched: boolean;
  dirty: boolean;
}

/**
 * Represents the state of a form
 */
export interface FormState<T extends Record<string, unknown>> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  dirty: Partial<Record<keyof T, boolean>>;
  isSubmitting: boolean;
  isValid: boolean;
  isDirty: boolean;
}

/**
 * Type for event handlers with proper typing
 */
export type EventHandler<T = Event> = (event: T) => void | Promise<void>;

/**
 * Type for change handlers
 */
export type ChangeHandler<T = unknown> = (value: T) => void | Promise<void>;

/**
 * Represents a sortable column configuration
 */
export interface SortConfig<T> {
  key: keyof T;
  direction: 'asc' | 'desc';
}

/**
 * Represents a filter configuration
 */
export interface FilterConfig<T> {
  field: keyof T;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'startsWith' | 'endsWith';
  value: unknown;
}

/**
 * Represents a selection state
 */
export interface SelectionState<T> {
  selected: Set<T>;
  toggle: (item: T) => void;
  selectAll: (items: T[]) => void;
  clear: () => void;
  isSelected: (item: T) => boolean;
  count: number;
}

/**
 * Type guard for checking if a value is not null/undefined
 */
export function isNotNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard for checking if a value is defined
 */
export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Asserts that a value is not null/undefined
 */
export function assertNotNull<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || `Expected value to be defined, but received ${value}`);
  }
}
