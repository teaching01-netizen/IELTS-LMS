import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { isBackendSchedulingEnabled } from '../../../services/backendBridge';
import { backendPost } from '../../../services/backendBridge';
import { useAuthSession } from '../../auth/authSession';

interface RegistrationFormData {
  wcode: string;
  email: string;
  studentName: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function StudentRegistrationRoute() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const { status: authStatus } = useAuthSession();
  const [formData, setFormData] = useState<RegistrationFormData>({
    wcode: '',
    email: '',
    studentName: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof RegistrationFormData, string>>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validateWcode = (wcode: string): boolean => {
    return /^W[0-9]{6}$/.test(wcode);
  };

  const validateEmail = (email: string): boolean => {
    return /^[^@]+@[^@]+\.[^@]+$/.test(email);
  };

  const handleInputChange = (field: keyof RegistrationFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
    
    if (field === 'wcode' && value && !validateWcode(value)) {
      setErrors(prev => ({
        ...prev,
        wcode: 'Wcode must be in format W followed by 6 digits (e.g., W250334)'
      }));
    }
    
    if (field === 'email' && value && !validateEmail(value)) {
      setErrors(prev => ({
        ...prev,
        email: 'Invalid email format'
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Partial<Record<keyof RegistrationFormData, string>> = {};
    
    if (!formData.wcode || !validateWcode(formData.wcode)) {
      newErrors.wcode = 'Wcode is required and must be in format W followed by 6 digits';
    }
    
    if (!formData.email || !validateEmail(formData.email)) {
      newErrors.email = 'Email is required and must be valid';
    }
    
    if (!formData.studentName) {
      newErrors.studentName = 'Name is required';
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Check authentication for backend registration
    const shouldUseBackendRegistration =
      Boolean(scheduleId) && isBackendSchedulingEnabled() && isUuid(scheduleId);

    if (shouldUseBackendRegistration && authStatus !== 'authenticated') {
      setSubmitError('Please log in to register for this exam');
      return;
    }
    
    setIsLoading(true);
    setSubmitError(null);
    
    try {
      if (shouldUseBackendRegistration) {
        const response = await backendPost<{
          registrationId: string;
          wcode: string;
          email: string;
          studentName: string;
          accessState: string;
        }>(`/v1/schedules/${scheduleId}/register`, {
          wcode: formData.wcode,
          email: formData.email,
          studentName: formData.studentName,
        });

        navigate(`/student/${scheduleId}/${response.wcode}`);
        return;
      }

      navigate(`/student/${scheduleId}/${formData.wcode}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Registration failed. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Exam Registration</h1>
        
        {submitError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{submitError}</p>
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="wcode" className="block text-sm font-medium text-gray-700 mb-2">
              Wcode
            </label>
            <input
              id="wcode"
              type="text"
              value={formData.wcode}
              onChange={(e) => handleInputChange('wcode', e.target.value.toUpperCase())}
              placeholder="W250334"
              className={`w-full px-3 py-2 border rounded-md ${
                errors.wcode ? 'border-red-300' : 'border-gray-300'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.wcode && <p className="mt-1 text-sm text-red-600">{errors.wcode}</p>}
            <p className="mt-1 text-xs text-gray-500">Format: W followed by 6 digits (e.g., W250334)</p>
          </div>
          
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              placeholder="student@example.com"
              className={`w-full px-3 py-2 border rounded-md ${
                errors.email ? 'border-red-300' : 'border-gray-300'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
          </div>
          
          <div>
            <label htmlFor="studentName" className="block text-sm font-medium text-gray-700 mb-2">
              Full Name
            </label>
            <input
              id="studentName"
              type="text"
              value={formData.studentName}
              onChange={(e) => handleInputChange('studentName', e.target.value)}
              placeholder="John Doe"
              className={`w-full px-3 py-2 border rounded-md ${
                errors.studentName ? 'border-red-300' : 'border-gray-300'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.studentName && <p className="mt-1 text-sm text-red-600">{errors.studentName}</p>}
          </div>
          
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Registering...' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  );
}
