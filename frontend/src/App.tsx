import React, { useState, useEffect } from 'react';
import axios, { AxiosError } from 'axios';
import AuthPage from './components/AuthPage';
import NotesPage from './components/NotesPage';
import BinPage from './components/BinPage';

interface Note {
  id: number;
  user_id: number;
  title: string;
  content: string;
  updated_at: string;
}

interface TrashedNote extends Note {
  trashed_at: string;
}

const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isTrashView, setIsTrashView] = useState(false);

  // Fetch notes
  const fetchNotes = async (): Promise<Note[]> => {
    if (!token) throw new Error('No token');
    try {
      const response = await axios.get<Note[]>(`${import.meta.env.VITE_NOTES_SERVICE_URL || 'http://localhost:3002'}/notes`, {
        headers: { Authorization: token },
      });
      return response.data.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        handleLogout();
      }
      throw error;
    }
  };

  // Fetch trashed notes
  const fetchTrashedNotes = async (): Promise<TrashedNote[]> => {
    if (!token) throw new Error('No token');
    try {
      const response = await axios.get<TrashedNote[]>(`${import.meta.env.VITE_NOTES_SERVICE_URL || 'http://localhost:3002'}/trashed-notes`, {
        headers: { Authorization: token },
      });
      return response.data.sort((a, b) => new Date(b.trashed_at).getTime() - new Date(a.trashed_at).getTime());
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        handleLogout();
      }
      throw error;
    }
  };

  // Handle login
  const handleLogin = (newToken: string) => {
    setToken(newToken);
    localStorage.setItem('token', newToken);
  };

  // Handle logout
  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('token');
    setIsTrashView(false);
  };

  // Check for stored token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      setToken(storedToken);
    }
  }, []);

  return (
    <div className="h-screen bg-gradient-to-br from-[#141414] to-[#1D1D1D] font-roboto flex flex-col text-gray-200">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet" />
      {token ? (
        <>
          <header className="h-[30px] bg-transparent text-white p-4 flex justify-between items-center flex-shrink-0">
            <h1 className="text-xl font-bold">Notefied</h1>
            <button
              onClick={handleLogout}
              className="w-[60px] h-[30px] bg-transparent rounded hover:text-red-400 flex items-center justify-center mt-[5px]"
            >
              Logout
            </button>
          </header>
          <div className="flex-1 flex justify-center items-center px-4 overflow-hidden relative">
            {isTrashView ? (
              <BinPage
                token={token}
                setIsTrashView={setIsTrashView}
                fetchNotes={fetchNotes}
                fetchTrashedNotes={fetchTrashedNotes}
                handleLogout={handleLogout}
              />
            ) : (
              <NotesPage
                token={token}
                setIsTrashView={setIsTrashView}
                fetchNotes={fetchNotes}
                fetchTrashedNotes={fetchTrashedNotes}
                handleLogout={handleLogout}
              />
            )}
          </div>
        </>
      ) : (
        <AuthPage onLogin={handleLogin} />
      )}
    </div>
  );
};

export default App;