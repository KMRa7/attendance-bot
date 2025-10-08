const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');
const app = express();

// 環境変数の確認
console.log('環境変数チェック:');
console.log('LINE_CHANNEL_ACCESS_TOKEN:', process.env.LINE_CHANNEL_ACCESS_TOKEN ? '設定済み ✓' : '未設定 ✗');
console.log('LINE_CHANNEL_SECRET:', process.env.LINE_CHANNEL_SECRET ? '設定済み ✓' : '未設定 ✗');

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

// JSONファイルでデータを保存
const DATA_FILE = path.join(__dirname, 'attendance_data.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// データ読み込み
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
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
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(data);
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

// 静的ファイル配信
app.use(express.static('public'));

// ヘルスチェック
app.get('/', (req, res) => {
  res.send('出退勤管理Bot稼働中！ 🚀');
});

// 管理画面用API（JSONパーサーを個別に適用）
app.get('/api/attendance', express.json(), (req, res) => {
  try {
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
  } catch (err) {
    console.error('API エラー:', err);
    res.status(500).json({ error: 'データ取得エラー' });
  }
});

// 勤務時間計算
function calculateWorkTime(record) {
  try {
    if (!record.clockOut) return '-';
    const start = new Date(record.clockInTime);
    const end = new Date(record.clockOutTime);
    const ms = end - start;
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}時間${minutes}分`;
  } catch (err) {
    console.error('勤務時間計算エラー:', err);
    return '-';
  }
}

// LINE Webhook（LINEミドルウェアを使用）
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook処理エラー:', err);
      res.status(500).end();
    });
});

// イベントハンドラー
async function handleEvent(event) {
  try {
    console.log('イベント受信:', event.type);

    if (event.type !== 'message' || event.message.type !== 'text') {
      return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const messageText = event.message.text.trim();
    
    console.log(`メッセージ: "${messageText}" from ${userId}`);

    // ユーザー名を取得
    if (!users[userId]) {
      try {
        const profile = await client.getProfile(userId);
        users[userId] = profile.displayName;
        saveUsers(users);
        console.log(`新規ユーザー: ${profile.displayName}`);
      } catch (err) {
        console.error('プロフィール取得エラー:', err);
        users[userId] = `ユーザー${userId.slice(-4)}`;
        saveUsers(users);
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
          console.log(`出勤記録: ${users[userId]} at ${timestamp}`);
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
          
          console.log(`退勤記録: ${users[userId]} at ${timestamp} (${hours}h${minutes}m)`);
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

  } catch (err) {
    console.error('イベント処理エラー:', err);
    return Promise.resolve(null);
  }
}

// ポート設定
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✓ Server is running on port ${port}`);
  console.log(`✓ 管理画面: http://localhost:${port}/admin.html`);
});
