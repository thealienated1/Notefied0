import React, { useState, useEffect, useCallback } from 'react';
import axios, { AxiosError } from 'axios';
import BackIcon from './assets/icons/back.svg';
import striptags from 'striptags';


interface TrashedNote {
  id: number;
  user_id: number;
  title: string;
  content: string;
  updated_at: string;
  trashed_at: string;
}

interface Note {
  id: number;
  user_id: number;
  title: string;
  content: string;
  updated_at: string;
}

interface BinPageProps {
  token: string;
  setIsTrashView: React.Dispatch<React.SetStateAction<boolean>>;
  fetchNotes: () => Promise<Note[]>;
  fetchTrashedNotes: () => Promise<TrashedNote[]>;
  handleLogout: () => void;
}

const stripHtml = (html: string): string => striptags(html);

const parseNoteContent = (content: string): string => {
  if (!content) return '(No content)';
  try {
    const doc = new DOMParser().parseFromString(content, 'text/html');
    const paragraphs = Array.from(doc.querySelectorAll('p'))
      .map(p => p.textContent?.trim())
      .filter(Boolean);
    return paragraphs.slice(0, 2).join('\n') || '(No content)';
  } catch {
    return '(Invalid content)';
  }
};

const BinPage: React.FC<BinPageProps> = ({ token, setIsTrashView, fetchNotes, fetchTrashedNotes, handleLogout }) => {
  const [trashedNotes, setTrashedNotes] = useState<TrashedNote[]>([]);
  const [selectedTrashedNotes, setSelectedTrashedNotes] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ noteId: number; x: number; y: number } | null>(null);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [notesToDeletePermanently, setNotesToDeletePermanently] = useState<number[]>([]);

  useEffect(() => {
    fetchTrashedNotes().then(setTrashedNotes);
  }, [fetchTrashedNotes]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${time}, ${dateStr}`;
  };

  const searchableTrashedNotes = React.useMemo(
    () =>
      trashedNotes.map(note => ({
        ...note,
        searchTitle: stripHtml(note.title).toLowerCase(),
        searchContent: stripHtml(note.content).toLowerCase(),
      })),
    [trashedNotes]
  );

  const filteredTrashedNotes = React.useMemo(() => {
    const query = searchQuery.toLowerCase();
    return searchableTrashedNotes
      .filter(note => note.searchTitle.includes(query) || note.searchContent.includes(query))
      .sort((a, b) => new Date(b.trashed_at).getTime() - new Date(a.trashed_at).getTime());
  }, [searchableTrashedNotes, searchQuery]);

  const handleSelectAll = useCallback(() => {
    if (selectedTrashedNotes.length === filteredTrashedNotes.length && filteredTrashedNotes.length > 0) {
      setSelectedTrashedNotes([]);
    } else {
      setSelectedTrashedNotes(filteredTrashedNotes.map((note) => note.id));
    }
  }, [selectedTrashedNotes, filteredTrashedNotes]);

  const restoreNote = async (id: number): Promise<Note | null> => {
    try {
      const response = await axios.post<Note>(
        `${import.meta.env.VITE_NOTES_SERVICE_URL || 'http://localhost:3002'}/trashed-notes/${id}/restore`,
        {},
        { headers: { Authorization: token } }
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        handleLogout();
      } else {
        console.error('Restore note error:', axiosError.response?.data || axiosError.message);
        alert('Failed to restore note');
        await fetchNotes();
        await fetchTrashedNotes();
      }
      return null;
    }
  };

  const executePermanentDeletion = async () => {
    if (!token || notesToDeletePermanently.length === 0) return;
    try {
      await Promise.all(
        notesToDeletePermanently.map((id) =>
          axios.delete(`${import.meta.env.VITE_NOTES_SERVICE_URL || 'http://localhost:3002'}/trashed-notes/${id}`, {
            headers: { Authorization: token },
          })
        )
      );
      setTrashedNotes((prev) => prev.filter((note) => !notesToDeletePermanently.includes(note.id)));
      setSelectedTrashedNotes((prev) => prev.filter((id) => !notesToDeletePermanently.includes(id)));
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        handleLogout();
      } else {
        console.error('Permanent delete error:', axiosError.response?.data || axiosError.message);
        alert('Failed to permanently delete notes');
        await fetchTrashedNotes().then(setTrashedNotes);
      }
    }
  };

  const triggerPermanentDeleteConfirmation = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setNotesToDeletePermanently(ids);
    setShowDeleteConfirmModal(true);
  }, []);

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>, noteId: number) => {
    e.preventDefault();
    const tile = e.currentTarget;
    const rect = tile.getBoundingClientRect();
    const x = rect.right - 2;
    let y = rect.top + 10;
    const menuHeight = 100;
    if (rect.top + menuHeight > window.innerHeight) {
      y = rect.top - menuHeight;
    }
    setContextMenu({ noteId, x, y });
  };

  return (
    <div className="w-full max-w-full h-full flex flex-col items-center relative" onClick={() => setContextMenu(null)}>
      <style>
        {`
          .custom-scrollbar::-webkit-scrollbar { width: 8px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #888; border-radius: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
          .custom-scrollbar { scrollbar-width: thin; scrollbar-color: #888 transparent; }
          .note-tile .ring { display: none; outline: 2px solid #f6f6f6; }
          .note-tile:hover .ring, .note-tile.selected .ring { outline: 1px solid #fefefe; display: block; }
          .note-tile.selected .ring { background-color: #5062e7; }
          .note-title {
            display: -webkit-box;
            -webkit-line-clamp: 1;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            max-height: 1.5em;
            font-size: 14px;
          }
          .note-content {
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            max-height: 4.5em;
            white-space: pre-line;
            font-size: 12px;
          }
        `}
      </style>
      <div className="absolute left-[2vw] bg-transparent top-[2vh]">
        <button
          onClick={() => {
            setIsTrashView(false);
            setSelectedTrashedNotes([]);
            setSearchQuery('');
          }}
          className="w-[45px] h-[45px] bg-transparent rounded-full flex items-center justify-center hover:text-[#5062E7] transition-all duration-300"
        >
          <img src={BackIcon} alt="Back" className="w-7 h-7 hover:w-8 hover:h-8 transition-all" />
        </button>
      </div>
      <div className="absolute left-[8vw] top-[2vh]">
        <h2 className="text-white text-[24px] font-bold">Bin</h2>
      </div>
      <div className="absolute left-[8vw] top-[6vh] flex items-center space-x-6 mt-5">
        <button
          onClick={handleSelectAll}
          className="w-[65px] h-[45px] bg-transparent text-white text-[12px] rounded-[25px] mr-10 hover:text-[13px]"
        >
          Select All
        </button>
        <button
          disabled={!selectedTrashedNotes.length}
          onClick={async () => {
            const restoredNotes = await Promise.all(selectedTrashedNotes.map((id) => restoreNote(id)));
            const validRestoredNotes = restoredNotes.filter((note): note is Note => note !== null);
            if (validRestoredNotes.length > 0) {
              setTrashedNotes((prev) => prev.filter((note) => !selectedTrashedNotes.includes(note.id)));
              setSelectedTrashedNotes([]);
            }
          }}
          className={`w-[45px] h-[45px] bg-[#1F1F1F] text-white text-[10px] rounded-[25px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] ${
            !selectedTrashedNotes.length ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#383838]'
          }`}
        >
          Restore
        </button>
        <button
          disabled={!selectedTrashedNotes.length}
          onClick={() => triggerPermanentDeleteConfirmation(selectedTrashedNotes)}
          className={`w-[45px] h-[45px] bg-[#1F1F1F] text-white text-[10px] rounded-[25px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] ${
            !selectedTrashedNotes.length ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#383838]'
          }`}
        >
          Delete
        </button>
      </div>
      <div className="flex flex-col items-center w-full">
        <input
          type="text"
          placeholder="Search Bin"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-[35px] w-[300px] bg-[#252525] text-white text-[12px] px-4 rounded-[20px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] focus:outline-none focus:ring-[0.5px] focus:ring-[#5062E7] mt-4"
        />
      </div>
      <div className="absolute left-[5vw] top-[15vh] w-[90vw] h-[calc(100%-20vh)] overflow-y-auto custom-scrollbar">
        <div className="flex flex-wrap gap-x-[2vw] gap-y-[2vh] mt-10">
          {!filteredTrashedNotes.length && (
            <p className="w-full text-center text-gray-500">Trash is empty.</p>
          )}
          {filteredTrashedNotes.map((note) => (
            <div
              key={note.id}
              className={`note-tile relative w-[20vw] h-[15vh] bg-[#1F1F1F] p-2 rounded-[15px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] cursor-pointer hover:bg-[#383838] transition-all duration-300 outline-none ${
                selectedTrashedNotes.includes(note.id) ? 'selected' : ''
              }`}
              onClick={() =>
                setSelectedTrashedNotes((prev) =>
                  prev.includes(note.id) ? prev.filter((id) => id !== note.id) : [...prev, note.id]
                )
              }
              onContextMenu={(e) => handleContextMenu(e, note.id)}
            >
              <div className="ring absolute top-4 right-4 w-[10px] h-[10px] rounded-full"></div>
              <div className="ml-[7px]">
                <strong className="text-white note-title">{stripHtml(note.title) || '(Untitled)'}</strong>
                <p className="text-gray-400 note-content">{parseNoteContent(note.content)}</p>
              </div>
              <span className="absolute bottom-1 right-2 text-[10px] text-gray-500">
                Trashed: {formatDate(note.trashed_at)}
              </span>
            </div>
          ))}
        </div>
      </div>
      {contextMenu && (
        <div
          className="absolute bg-[#1F1F1F] text-white rounded-[10px] shadow-xl w-[120px] flex flex-col py-2 z-50 transition-all duration-300"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={async () => {
              const restoredNote = await restoreNote(contextMenu.noteId);
              if (restoredNote) {
                setTrashedNotes((prev) => prev.filter((note) => note.id !== contextMenu.noteId));
                setSelectedTrashedNotes((prev) => prev.filter((id) => id !== contextMenu.noteId));
              }
              setContextMenu(null);
            }}
            className="w-[100px] h-[25px] mx-auto text-left pl-3 text-[14px] rounded-[13px] hover:shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] hover:bg-[#383838] text-green-400"
          >
            Restore
          </button>
          <button
            onClick={() => {
              triggerPermanentDeleteConfirmation([contextMenu.noteId]);
              setContextMenu(null);
            }}
            className="w-[100px] h-[25px] mx-auto text-left pl-3 text-[14px] rounded-[13px] hover:bg-[#383838] hover:shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] text-red-400 mt-4"
          >
            Delete
          </button>
        </div>
      )}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-[#1F1F1F] rounded-[20px] w-[260px] h-[130px] p-4 flex flex-col items-center justify-between shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)]">
            <div className="text-center">
              <p className="text-white text-[15px] mb-1">Are You Sure?</p>
              <p className="text-gray-400 text-[10px]">This will remove permanently</p>
            </div>
            <div className="flex justify-center space-x-4 w-full">
              <button
                onClick={async () => {
                  await executePermanentDeletion();
                  setShowDeleteConfirmModal(false);
                  setNotesToDeletePermanently([]);
                }}
                className="w-[60px] h-[23px] bg-red-500 hover:bg-red-400 text-white text-xs shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] rounded-[20px]"
              >
                Yes
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirmModal(false);
                  setNotesToDeletePermanently([]);
                }}
                className="w-[60px] h-[23px] bg-[#5062E7] hover:bg-[#677FF6] text-white text-xs shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] rounded-[20px]"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BinPage;