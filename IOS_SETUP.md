# Morpheus iOS 接入说明

## 1. 安装依赖

```bash
npm install
```

## 2. 初始化 Capacitor（首次）

```bash
npx cap init Morpheus com.morpheus.dreamjournal --web-dir .
```

## 3. 添加 iOS 平台（首次）

```bash
npx cap add ios
```

## 4. 同步到 iOS 项目

```bash
npm run sync
```

## 5. 打开 Xcode

```bash
npm run open
```

## 6. Info.plist 确认以下权限

```xml
<key>NSSpeechRecognitionUsageDescription</key>
<string>Morpheus 需要语音识别权限，用于将你的梦境描述转为文字。</string>

<key>NSMicrophoneUsageDescription</key>
<string>Morpheus 需要麦克风权限，用于录制你的梦境描述。</string>

<key>NSUserNotificationsUsageDescription</key>
<string>Morpheus 可以在每天早晨提醒你记录梦境。</string>
```
