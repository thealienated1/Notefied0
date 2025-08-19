import React, { useState } from 'react';
import axios, { AxiosError } from 'axios';

interface AuthPageProps {
  onLogin: (token: string) => void;
}

interface ErrorResponse {
  error?: string;
}

const AuthPage: React.FC<AuthPageProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loginError, setLoginError] = useState<string>('');
  const [registerError, setRegisterError] = useState<string>('');

  const login = async () => {
    try {
      const response = await axios.post<{ token: string }>(
        `${import.meta.env.VITE_USER_SERVICE_URL || '/api/user'}/login`,
        { username, password },
        { headers: { 'Content-Type': 'application/json' } }
      );
      onLogin(response.data.token);
      setLoginError('');
    } catch (error) {
      const axiosError = error as AxiosError;
      console.error('Login failed:', axiosError.response?.data || axiosError.message);
      setLoginError('Incorrect Username or Password');
    }
  };

  const register = async () => {
    if (password !== confirmPassword) {
      setRegisterError("Password Doesn't Match");
      return;
    }
    try {
      const response = await axios.post(
        `${import.meta.env.VITE_USER_SERVICE_URL || '/api/user'}/register`,
        { username, password },
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (response.status === 201) {
        setRegisterError('');
        setIsRegistering(false);
        setUsername('');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (error) {
      const axiosError = error as AxiosError<ErrorResponse>;
      console.error('Registration failed:', axiosError.response?.data || axiosError.message);
      const errorMsg = axiosError.response?.data?.error;
      if (errorMsg && errorMsg.toLowerCase().includes('username')) {
        setRegisterError('Username Already Exists');
      } else {
        setRegisterError('Registration Failed');
      }
    }
  };

  return (
    <div className="flex-1 flex justify-center items-center px-4 overflow-hidden">
      <div className="w-[440px] h-[536px] bg-[#242424] rounded-[20px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] flex justify-center items-center">
        <div className="w-[400px] h-[500px] bg-[#191919] rounded-[20px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] p-6 flex flex-col">
          <h2 className="text-2xl font-small text-white mb-6 text-center">
            {isRegistering ? 'Sign-up' : 'Sign-in'}
          </h2>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="w-full p-3 bg-[#121212] text-white text-xs rounded-[20px] mb-6 focus:outline-none"
            onFocus={() => {
              setLoginError('');
              setRegisterError('');
            }}
          />
          {isRegistering ? (
            <>
              <div className="relative mb-6">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full p-3 bg-[#121212] text-white text-xs rounded-[20px] focus:outline-none"
                  onFocus={() => setRegisterError('')}
                />
              </div>
              <div className="relative mb-6">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm Password"
                  className="w-full p-3 bg-[#121212] text-white text-xs rounded-[20px] focus:outline-none"
                  onFocus={() => setRegisterError('')}
                />
                {registerError && (
                  <div className="absolute left-0 bottom-[-20px] text-red-500 text-[10px]">{registerError}</div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="relative mb-6">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full p-3 bg-[#121212] text-white text-xs rounded-[20px] focus:outline-none"
                  onFocus={() => {
                    setLoginError('');
                    setRegisterError('');
                  }}
                />
                {loginError && (
                  <div className="absolute left-0 bottom-[-20px] text-red-500 text-[10px]">{loginError}</div>
                )}
              </div>
              <div className="text-center text-sm text-gray-400 mb-6">Forgot password?</div>
            </>
          )}
          <div className="flex justify-center mb-6">
            <button
              onClick={isRegistering ? register : login}
              className="w-[100px] h-[30px] bg-[#0072DB] text-white rounded-[30px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] hover:bg-blue-700 text-xs mt-2"
            >
              {isRegistering ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
          <div className="text-center text-sm text-gray-400 mb-5">
            {isRegistering ? (
              <>
                Have an account?{' '}
                <span
                  className="text-purple-400 cursor-pointer"
                  onClick={() => {
                    setIsRegistering(false);
                    setLoginError('');
                    setRegisterError('');
                  }}
                >
                  Sign-in
                </span>
              </>
            ) : (
              <>
                Don’t have an account?{' '}
                <span
                  className="text-purple-400 cursor-pointer"
                  onClick={() => {
                    setIsRegistering(true);
                    setLoginError('');
                    setRegisterError('');
                  }}
                >
                  Sign-up
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;