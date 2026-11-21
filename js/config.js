// Веб-конфіг Firebase. Це не секрет: він однаково видно кожному, хто
// відкрив сторінку; доступ до даних обмежують правила у firestore.rules.
// null — хмари немає, застосунок працює лише в межах пристрою.
export const FIREBASE = {
  apiKey: 'AIzaSyDPjvrUNgQUqUAZysxLNmY1EECM_9qr0Qc',
  authDomain: 'mywatchshelf.firebaseapp.com',
  projectId: 'mywatchshelf',
  storageBucket: 'mywatchshelf.firebasestorage.app',
  messagingSenderId: '520582060325',
  appId: '1:520582060325:web:eda9af48604111f08662cc',
};

// Веб-клієнт Google для входу (той, що Firebase створив сам). Теж не
// секрет. Адреса сайту має стояти серед його «Authorized redirect URIs».
export const GOOGLE_CLIENT_ID = '520582060325-j9lute0q05tdusso96qqnbso6ak2l39j.apps.googleusercontent.com';
