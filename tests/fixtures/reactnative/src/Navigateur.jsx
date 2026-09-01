import { WebView } from 'react-native-webview';

export default function Navigateur({ url }) {
  return <WebView source={{ uri: url }} javaScriptEnabled={true} allowFileAccess={true} />;
}
