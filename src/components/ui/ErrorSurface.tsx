interface ErrorSurfaceProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  secondaryOnAction?: () => void;
}

export function ErrorSurface({
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  secondaryOnAction,
}: ErrorSurfaceProps) {
  return (
    <div className="flex items-center justify-center w-full h-screen bg-gray-50">
      <div className="text-center space-y-4 max-w-md px-4" role="alert" aria-live="assertive">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-600">{description}</p>
        {actionLabel && onAction ? (
          <button
            onClick={onAction}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            {actionLabel}
          </button>
        ) : null}
        {secondaryActionLabel && secondaryOnAction ? (
          <button
            onClick={secondaryOnAction}
            className="mt-4 ml-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            {secondaryActionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
