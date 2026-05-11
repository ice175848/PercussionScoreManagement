const API_URL = 'https://script.google.com/macros/s/AKfycbwV45Ba8kSNBPv_kzRMujzQOAIdeQ6ObMcsN9zVuPFqf4Qw2tk1hehZCmQyMGvDV48/exec';

const instruments = [
  "小鼓 (Snare Drum)",
  "大鼓 (Bass Drum)",
  "雙鈸 (Crash Cymbals)",
  "吊鈸 (Suspended Cymbal)",
  "三角鐵 (Triangle)",
  "鈴鼓 (Tambourine)",
  "響木 (Wood Block)",
  "鐵琴 (Glockenspiel)",
  "木琴 (Xylophone)",
  "馬林巴琴 (Marimba)",
  "顫音琴 (Vibraphone)",
  "管鐘 (Chimes/Tubular Bells)",
  "鑼 (Tam-tam/Gong)",
  "爵士鼓 (Drum Set)",
  "響板 (Castanets)",
  "牛鈴 (Cowbell)",
  "刮胡 (Guiro)",
  "沙鈴 (Maracas)",
  "響棒 (Claves)",
  "木魚 (Temple Blocks)",
  "邦哥鼓 (Bongos)",
  "康加鼓 (Congas)",
  "鐵沙鈴 (Cabasa)",
  "風鈴 (Wind Chimes/Mark Tree)"
];

async function addInstruments() {
  for (const inst of instruments) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          performance_name: '樂器標籤',
          piece_id: '樂器表',
          title: '樂器表',
          part_name: '預設匯入',
          instrument_name: inst,
          sheetId: '1KyWrapRb3irlh5U4c2amb4eaTeMaoum6EDieOWo83jg'
        })
      });
      const data = await res.json();
      console.log(`Added: ${inst}`, data);
    } catch (e) {
      console.error(`Failed: ${inst}`, e.message);
    }
  }
}

addInstruments();
