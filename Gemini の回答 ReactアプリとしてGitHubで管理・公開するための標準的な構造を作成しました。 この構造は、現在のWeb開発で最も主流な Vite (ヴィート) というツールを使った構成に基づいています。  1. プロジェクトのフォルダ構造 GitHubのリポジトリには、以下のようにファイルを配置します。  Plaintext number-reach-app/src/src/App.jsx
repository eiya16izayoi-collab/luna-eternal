import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  onSnapshot, 
  updateDoc, 
  getDoc,
  collection
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { Target, Users, Send, RotateCcw, AlertCircle, Play, UserCircle } from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'number-reach-v8';

const App = () => {
  const [user, setUser] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [userName, setUserName] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [gameState, setGameState] = useState(null);
  const [inputVal, setInputVal] = useState('');
  const [currentOp, setCurrentOp] = useState('mul');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // --- Auth Setup ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- Game Sync ---
  useEffect(() => {
    // 認証済みかつ入室済みの場合のみリスナーを設定
    if (!user || !isJoined || !roomName) return;

    // RULE 1: 正しいパス構造 (/artifacts/{appId}/public/data/{collectionName}/{docId})
    // 今回は roomName をドキュメントIDとして使用するため、コレクション名は 'rooms' と定義します
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomName);
    
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        setGameState(snapshot.data());
      }
    }, (err) => {
      console.error("Firestore Error", err);
    });

    return () => unsubscribe();
  }, [user, isJoined, roomName]);

  const isPrime = (num) => {
    if (num <= 1) return false;
    for (let i = 2; i <= Math.sqrt(num); i++) {
      if (num % i === 0) return false;
    }
    return true;
  };

  const generateValidTarget = () => {
    let newTarget;
    do {
      newTarget = Math.floor(Math.random() * 90001) + 10000;
    } while (isPrime(newTarget));
    return newTarget;
  };

  const handleJoinRoom = async () => {
    if (!user) return; // 認証待ち
    if (!userName.trim() || !roomName.trim()) {
      setError("名前とルーム名を入力してください");
      return;
    }
    setLoading(true);
    setError('');

    try {
      // RULE 1 に従ったパス指定
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomName);
      const snap = await getDoc(roomRef);

      if (!snap.exists()) {
        const newGame = {
          target: generateValidTarget(),
          current: 1,
          turn: 1,
          maxTurns: 50,
          players: [{ id: user.uid, name: userName }],
          turnIndex: 0,
          status: 'waiting',
          history: [`${userName}がルームを作成しました`],
          lastInput: null,
          winner: null,
          hostId: user.uid
        };
        await setDoc(roomRef, newGame);
      } else {
        const data = snap.data();
        if (data.players.length >= 8 && !data.players.find(p => p.id === user.uid)) {
          setError("このルームは満員（最大8名）です");
          setLoading(false);
          return;
        }
        
        if (!data.players.find(p => p.id === user.uid)) {
          const updatedPlayers = [...data.players, { id: user.uid, name: userName }];
          await updateDoc(roomRef, {
            players: updatedPlayers,
            history: [...data.history, `${userName}が入室しました`]
          });
        }
      }
      setIsJoined(true);
    } catch (err) {
      console.error(err);
      setError("ルームへの接続に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = async () => {
    if (!user || !gameState || gameState.players.length < 2) {
      setError("開始には少なくとも2人のプレイヤーが必要です");
      return;
    }
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomName);
    await updateDoc(roomRef, { status: 'playing', history: [...gameState.history, "ゲーム開始！"] });
  };

  const executeTurn = async () => {
    if (!user || !gameState || gameState.status !== 'playing') return;
    if (gameState.players[gameState.turnIndex].id !== user.uid) return;

    const val = parseFloat(inputVal);
    if (isNaN(val) || val <= 0 || val > 100) {
      setError("1〜100の数値を入力してください");
      return;
    }
    if (val === 1 && gameState.lastInput === 1) {
      setError("1を連続で入力することはできません");
      return;
    }

    let nextVal = currentOp === 'mul' ? gameState.current * val : gameState.current / val;
    nextVal = Math.round(nextVal * 1000) / 1000;

    let nextStatus = 'playing';
    let nextTurnIndex = (gameState.turnIndex + 1) % gameState.players.length;
    let winner = null;

    const logEntry = `${userName}: ${currentOp === 'mul' ? '×' : '÷'} ${val} → ${nextVal.toLocaleString()}`;
    const newHistory = [...gameState.history, logEntry];

    if (nextVal > gameState.target + 0.001) {
      nextStatus = 'finished';
      winner = "バースト！生存者の勝利";
      newHistory.push(`${userName}がオーバー！`);
    } else if (Math.abs(nextVal - gameState.target) < 0.01) {
      nextStatus = 'finished';
      winner = userName;
      newHistory.push(`${userName}がターゲット達成！`);
    } else if (gameState.turn >= gameState.maxTurns) {
      nextStatus = 'finished';
      winner = "時間切れ";
      newHistory.push("最大ターン数に到達しました");
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomName);
    await updateDoc(roomRef, {
      current: nextVal,
      turn: gameState.turn + 1,
      turnIndex: nextTurnIndex,
      status: nextStatus,
      history: newHistory.slice(-20),
      lastInput: val,
      winner: winner
    });

    setInputVal('');
    setError('');
  };

  const resetGame = async () => {
    if (!user) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomName);
    await updateDoc(roomRef, {
      target: generateValidTarget(),
      current: 1,
      turn: 1,
      turnIndex: 0,
      status: 'playing',
      history: ["再戦開始！"],
      lastInput: null,
      winner: null
    });
  };

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-white font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
          <h1 className="text-4xl font-black text-center bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-8 italic">NUMBER REACH</h1>
          <div className="space-y-5">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase block mb-2 tracking-widest">あなたの名前</label>
              <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="なまえ" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:ring-2 focus:ring-cyan-500 outline-none text-center font-bold" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase block mb-2 tracking-widest">ルーム名 (合言葉)</label>
              <input type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="部屋の名前" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:ring-2 focus:ring-cyan-500 outline-none text-center font-bold" />
            </div>
            {error && <p className="text-red-400 text-xs flex items-center justify-center gap-1"><AlertCircle size={14}/> {error}</p>}
            <button onClick={handleJoinRoom} disabled={loading || !user} className="w-full bg-cyan-600 hover:bg-cyan-500 py-4 rounded-xl font-bold transition-all disabled:opacity-50 shadow-lg shadow-cyan-900/20 active:scale-95">入室する</button>
          </div>
        </div>
      </div>
    );
  }

  if (!gameState) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-cyan-500 font-bold animate-pulse tracking-widest">SYNCING DATA...</div>;

  const currentPlayer = gameState.players[gameState.turnIndex];
  const isMyTurn = gameState.status === 'playing' && currentPlayer?.id === user.uid;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 flex flex-col items-center max-w-4xl mx-auto font-sans overflow-x-hidden">
      
      {/* プレイヤーリスト */}
      <div className="w-full flex flex-wrap gap-2 mb-6 justify-center">
        {gameState.players.map((p, i) => (
          <div key={p.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] md:text-xs font-bold transition-all ${
            gameState.turnIndex === i && gameState.status === 'playing' ? 'bg-cyan-500 border-cyan-400 text-white scale-110 shadow-lg' : 'bg-slate-900 border-slate-800 text-slate-400 opacity-60'
          }`}>
            <UserCircle size={14} /> {p.name}
          </div>
        ))}
        {gameState.players.length < 8 && gameState.status === 'waiting' && (
          <div className="px-3 py-1.5 rounded-full border border-dashed border-slate-700 text-slate-600 text-[10px] md:text-xs font-bold">
            枠あり ({gameState.players.length}/8)
          </div>
        )}
      </div>

      {/* メインディスプレイ */}
      <div className="w-full grid md:grid-cols-2 gap-4 mb-8">
        <div className="bg-slate-900/50 backdrop-blur border border-slate-800 rounded-3xl p-6 text-center shadow-inner">
          <Target className="mx-auto text-cyan-400 mb-2" size={24} />
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Target Value</p>
          <p className="text-4xl font-black text-cyan-400 font-mono tracking-tighter tabular-nums">{gameState.target.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900/50 backdrop-blur border border-slate-800 rounded-3xl p-6 text-center shadow-inner">
          <Users className="mx-auto text-emerald-400 mb-2" size={24} />
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Current Value</p>
          <p className="text-4xl font-black text-emerald-400 font-mono tracking-tighter tabular-nums">{gameState.current.toLocaleString()}</p>
        </div>
      </div>

      {/* ゲーム制御セクション */}
      <div className="w-full max-w-md space-y-4">
        {gameState.status === 'waiting' ? (
          <div className="text-center p-8 bg-slate-900/80 border border-slate-800 rounded-3xl shadow-xl">
            <h2 className="text-xl font-bold mb-4 tracking-widest">WAITTING ROOM</h2>
            {gameState.hostId === user.uid ? (
              <button onClick={handleStartGame} className="w-full bg-emerald-600 hover:bg-emerald-500 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/20 active:scale-95">
                <Play size={20} /> ゲームを開始する
              </button>
            ) : (
              <p className="text-slate-500 text-sm italic animate-pulse">ホストが開始するのを待っています...</p>
            )}
          </div>
        ) : gameState.status === 'playing' ? (
          <div className={`space-y-4 transition-all ${!isMyTurn ? 'opacity-40 grayscale' : ''}`}>
            <div className={`p-4 rounded-2xl text-center font-bold text-sm ${isMyTurn ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 animate-pulse' : 'bg-slate-900 text-slate-500 border border-slate-800'}`}>
              {isMyTurn ? "🚀 あなたのターンです！" : `⌛ ${currentPlayer?.name} の思考中...`}
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setCurrentOp('mul')} className={`py-4 rounded-xl font-black text-2xl border-b-4 transition-all ${currentOp === 'mul' ? 'bg-cyan-600 border-cyan-800 text-white' : 'bg-slate-800 border-slate-900 text-slate-500'}`}>×</button>
              <button onClick={() => setCurrentOp('div')} className={`py-4 rounded-xl font-black text-2xl border-b-4 transition-all ${currentOp === 'div' ? 'bg-cyan-600 border-cyan-800 text-white' : 'bg-slate-800 border-slate-900 text-slate-500'}`}>÷</button>
            </div>
            
            <div className="flex gap-2">
              <input type="number" value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder="1〜100" className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-4 focus:ring-2 focus:ring-cyan-500 outline-none font-bold text-xl text-center shadow-inner" />
              <button onClick={executeTurn} className="bg-emerald-600 hover:bg-emerald-500 px-8 rounded-xl flex items-center justify-center shadow-lg active:scale-95 transition-all text-white"><Send size={24} /></button>
            </div>
            {error && <p className="text-red-400 text-xs text-center font-bold">{error}</p>}
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center space-y-4 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-500 via-orange-500 to-yellow-500 animate-gradient-x"></div>
            <h2 className="text-3xl font-black text-yellow-400 tracking-tighter">GAME FINISHED</h2>
            <p className="text-slate-300 font-bold text-xl">{gameState.winner}</p>
            <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
              <p className="text-[10px] text-slate-500 mb-1 font-bold uppercase tracking-widest">Final Value</p>
              <p className="text-2xl font-mono font-bold text-white">{gameState.current.toLocaleString()}</p>
            </div>
            <button onClick={resetGame} className="w-full bg-slate-800 hover:bg-slate-700 py-4 rounded-xl font-bold flex items-center justify-center gap-2 border border-slate-700 transition-all active:scale-95">
              <RotateCcw size={20} /> もう一度遊ぶ
            </button>
          </div>
        )}
      </div>

      {/* 履歴ログ */}
      <div className="w-full max-w-lg mt-8 bg-slate-900/30 border border-slate-800 rounded-3xl p-6 h-48 overflow-hidden flex flex-col backdrop-blur-sm">
        <p className="text-[10px] text-slate-500 font-bold uppercase mb-3 tracking-widest text-center opacity-50">Operation Log Feed</p>
        <div className="flex-1 overflow-y-auto space-y-1.5 text-[11px] font-mono text-slate-400 custom-scrollbar">
          {gameState.history.slice().reverse().map((log, i) => (
            <div key={i} className="border-l-2 border-slate-700 pl-3 py-1 bg-slate-800/20 rounded-r-lg">{log}</div>
          ))}
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        @keyframes gradient-x {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient-x { background-size: 200% 200%; animation: gradient-x 3s linear infinite; }
      `}</style>
    </div>
  );
};

export default App;
