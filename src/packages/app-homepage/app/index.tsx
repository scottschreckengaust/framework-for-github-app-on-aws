import { StyleSheet, Text, View, Pressable, Linking, Platform } from 'react-native';
import Head from 'expo-router/head';

const GITHUB_OAUTH_URL =
  'https://github.com/login/oauth/authorize?client_id=PLACEHOLDER&scope=repo';

const DOCS_URL =
  'https://github.com/scottschreckengaust/framework-for-github-app-on-aws';

const COMMANDS = [
  { name: 'help', description: 'Show available commands' },
  { name: 'echo', description: 'Echo back your message' },
  { name: 'check', description: 'Run CI checks on the current PR' },
];

export default function LandingPage() {
  return (
    <View style={styles.container}>
      <Head>
        <title>ai3-mvp - GitHub App</title>
      </Head>
      <View style={styles.hero}>
        <Text style={styles.title}>ai3-mvp</Text>
        <Text style={styles.subtitle}>
          A serverless GitHub App powered by AWS Step Functions
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Available Commands</Text>
        <Text style={styles.sectionDescription}>
          Mention <Text style={styles.code}>@ai3-mvp</Text> or use{' '}
          <Text style={styles.code}>/ai3-mvp</Text> followed by a command:
        </Text>
        <View style={styles.commandList}>
          {COMMANDS.map((cmd) => (
            <View key={cmd.name} style={styles.commandRow}>
              <Text style={styles.commandName}>{cmd.name}</Text>
              <Text style={styles.commandDescription}>{cmd.description}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={styles.primaryButton}
          onPress={() => Linking.openURL(GITHUB_OAUTH_URL)}
        >
          <Text style={styles.primaryButtonText}>Authorize with GitHub</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => Linking.openURL(DOCS_URL)}
        >
          <Text style={styles.secondaryButtonText}>View Documentation</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Built with AWS CDK, Step Functions, and Lambda
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    minHeight: '100%',
  },
  hero: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 48,
    fontWeight: '700',
    color: '#f0f6fc',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: '#8b949e',
    textAlign: 'center',
    maxWidth: 480,
  },
  section: {
    width: '100%',
    maxWidth: 560,
    marginBottom: 48,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#f0f6fc',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#8b949e',
    marginBottom: 16,
  },
  code: {
    fontFamily: 'monospace',
    backgroundColor: '#161b22',
    color: '#79c0ff',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  commandList: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    overflow: 'hidden',
  },
  commandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  commandName: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: '#79c0ff',
    width: 80,
  },
  commandDescription: {
    fontSize: 14,
    color: '#c9d1d9',
    flex: 1,
  },
  actions: {
    alignItems: 'center',
    gap: 12,
    marginBottom: 48,
  },
  primaryButton: {
    backgroundColor: '#238636',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 6,
    minWidth: 220,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#30363d',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 6,
    minWidth: 220,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#c9d1d9',
    fontSize: 16,
    fontWeight: '500',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
  },
  footerText: {
    fontSize: 12,
    color: '#8b949e',
  },
});
