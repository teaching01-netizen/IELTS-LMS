interface LoadingSurfaceProps {
  label: string;
}

export function LoadingSurface({ label }: LoadingSurfaceProps) {
  return (
    <div className="flex items-center justify-center w-full h-screen bg-gray-50">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-600 font-medium">{label}</p>
      </div>
    </div>
  );
}
