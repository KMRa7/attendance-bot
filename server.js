const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');
const app = express();

// 環境変数からLINE Bot設定を取得（Render.comで設定します）
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dgyH8u+OqqG7LMj2lOG/5PjwsqEKDSh8TgXdZynTr2LjlJczMEC2fpwsiERpUbzRWopKSgDBxiRz1+t9tcPitl4nU9xYoutx3NZjCdxff6fyQsPFiQT8PdE9Sr3x1LhKCCukftAhMCaF7eCzMsXr8AdB04t89/1O/w1cDnyilFU=',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'c0703de30b34efbfc0e769e60fd746d3'
};

const client = new line.Client(config);

// JSONファイルでデータを保存
const DATA_FILE = path.join(__dirname, 'attendance_data.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// データ読み込み
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('データ読み込みエラー:', err);
  }
  return {};
}

// ユーザー情報読み込み
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('ユーザー情報読み込みエラー:', err);
  }
  return {};
}

// データ保存
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('データ保存エラー:', err);
  }
}

// ユーザー情報保存
function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('ユーザー情報保存エラー:', err);
  }
}

let attendanceRecords = loadData();
let users = loadUsers();

// 静的ファイルの配信
app.use(express.static('public'));
app.use(express.json());

// ヘルスチェック用（Render.comがサーバーの状態を確認するため）
app.get('/', (req, res) => {
  res.send('出退勤管理Bot稼働中！');
});

// 管理画面用API - 全データ取得
app.get('/api/attendance', (req, res) => {
  const data = [];
  
  for (const [userId, records] of Object.entries(attendanceRecords)) {
    const userName = users[userId] || `ユーザー${userId.slice(-4)}`;
    records.forEach(record => {
      data.push({
        userId,
        userName,
        clockIn: record.clockIn,
        clockOut: record.clockOut || '未退勤',
        workTime: record.clockOut ? calculateWorkTime(record) : '-'
      });
    });
  }
  
  res.json(data.reverse());
});

// 勤務時間計算
function calculateWorkTime(record) {
  if (!record.clockOut) return '-';
  const start = new Date(record.clockInTime);
  const end = new Date(record.clockOutTime);
  const ms = end - start;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}時間${minutes}分`;
}

// LINE Webhook
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// イベントハンドラー
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const messageText = event.message.text.trim();
  
  // ユーザー名を取得して保存
  if (!users[userId]) {
    try {
      const profile = await client.getProfile(userId);
      users[userId] = profile.displayName;
      saveUsers(users);
    } catch (err) {
      users[userId] = `ユーザー${userId.slice(-4)}`;
    }
  }
  
  if (!attendanceRecords[userId]) {
    attendanceRecords[userId] = [];
  }
  
  const userRecords = attendanceRecords[userId];
  const now = new Date();
  const timestamp = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  let replyMessage;

  switch (messageText) {
    case '出勤':
      const lastRecord = userRecords[userRecords.length - 1];
      if (lastRecord && !lastRecord.clockOut) {
        replyMessage = {
          type: 'text',
          text: '既に出勤済みです。先に退勤を記録してください。'
        };
      } else {
        userRecords.push({
          clockIn: timestamp,
          clockInTime: now.toISOString(),
          clockOut: null
        });
        saveData(attendanceRecords);
        replyMessage = {
          type: 'text',
          text: `✅ 出勤を記録しました\n時刻: ${timestamp}\n\n今日も一日頑張りましょう！`
        };
      }
      break;

    case '退勤':
      const currentRecord = userRecords[userRecords.length - 1];
      if (!currentRecord || currentRecord.clockOut) {
        replyMessage = {
          type: 'text',
          text: '出勤記録がありません。先に出勤を記録してください。'
        };
      } else {
        currentRecord.clockOut = timestamp;
        currentRecord.clockOutTime = now.toISOString();
        saveData(attendanceRecords);
        
        const workTimeMs = new Date(currentRecord.clockOutTime) - new Date(currentRecord.clockInTime);
        const hours = Math.floor(workTimeMs / (1000 * 60 * 60));
        const minutes = Math.floor((workTimeMs % (1000 * 60 * 60)) / (1000 * 60));
        
        replyMessage = {
          type: 'text',
          text: `✅ 退勤を記録しました\n時刻: ${timestamp}\n勤務時間: ${hours}時間${minutes}分\n\nお疲れ様でした！`
        };
      }
      break;

    case '勤怠確認':
    case '履歴':
      if (userRecords.length === 0) {
        replyMessage = {
          type: 'text',
          text: 'まだ勤怠記録がありません。'
        };
      } else {
        let historyText = '📊 直近の勤怠記録\n\n';
        const recentRecords = userRecords.slice(-5).reverse();
        
        recentRecords.forEach((record, index) => {
          historyText += `【${recentRecords.length - index}】\n`;
          historyText += `出勤: ${record.clockIn}\n`;
          if (record.clockOut) {
            historyText += `退勤: ${record.clockOut}\n`;
            historyText += `勤務時間: ${calculateWorkTime(record)}\n`;
          } else {
            historyText += `退勤: 未記録\n`;
          }
          historyText += '\n';
        });
        
        replyMessage = {
          type: 'text',
          text: historyText
        };
      }
      break;

    case 'ヘルプ':
    case '使い方':
      replyMessage = {
        type: 'text',
        text: `📱 出退勤管理Bot 使い方\n\n「出勤」→ 出勤時刻を記録\n「退勤」→ 退勤時刻を記録\n「勤怠確認」or「履歴」→ 直近の記録を表示\n「ヘルプ」→ この使い方を表示\n\n※時刻は自動的に記録されます`
      };
      break;

    default:
      replyMessage = {
        type: 'text',
        text: `コマンドが認識できませんでした。\n\n利用可能なコマンド:\n・出勤\n・退勤\n・勤怠確認\n・ヘルプ`
      };
  }

  return client.replyMessage(event.replyToken, replyMessage);
}

// ポート設定（Render.comの環境変数を使用）
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});