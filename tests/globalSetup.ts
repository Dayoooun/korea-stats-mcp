/**
 * Playwright Global Setup
 * MCP Inspector 시작 및 세션 토큰 캡처
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TOKEN_FILE = path.join(__dirname, '..', '.mcp-session-token');
const PORT = 6274;

let inspectorProcess: ChildProcess | null = null;

async function globalSetup(): Promise<void> {
  console.log('Starting MCP Inspector...');

  // 기존 토큰 파일 삭제
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE);
  }

  return new Promise((resolve, reject) => {
    // Inspector 시작
    inspectorProcess = spawn('npx', ['@modelcontextprotocol/inspector', 'dist/index.js'], {
      cwd: path.join(__dirname, '..'),
      shell: true,
      env: {
        ...process.env,
        KOSIS_API_KEY: process.env.KOSIS_API_KEY || '',
      },
    });

    let output = '';
    let tokenFound = false;

    const timeout = setTimeout(() => {
      if (!tokenFound) {
        console.log('Timeout waiting for token, continuing anyway...');
        resolve();
      }
    }, 30000);

    inspectorProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      console.log('Inspector:', text);

      // 세션 토큰 캡처 (다양한 형식 지원)
      const tokenMatch = text.match(/session[_\s]?token[:\s]+([a-zA-Z0-9_-]+)/i) ||
                         text.match(/token[:\s]+([a-zA-Z0-9_-]{20,})/i) ||
                         text.match(/MCP_PROXY_TOKEN[=:\s]+([a-zA-Z0-9_-]+)/i);

      if (tokenMatch && !tokenFound) {
        tokenFound = true;
        const token = tokenMatch[1];
        console.log(`Session token captured: ${token.substring(0, 10)}...`);
        fs.writeFileSync(TOKEN_FILE, token);
        clearTimeout(timeout);
        resolve();
      }

      // Inspector가 준비됨을 나타내는 메시지
      if (text.includes('listening') || text.includes('ready') || text.includes(`:${PORT}`)) {
        if (!tokenFound) {
          // 토큰 없이도 진행 (이전 버전 호환)
          console.log('Inspector ready (no token required or already set)');
          clearTimeout(timeout);
          resolve();
        }
      }
    });

    inspectorProcess.stderr?.on('data', (data: Buffer) => {
      console.error('Inspector Error:', data.toString());
    });

    inspectorProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Inspector가 시작되었으면 바로 진행 (토큰은 URL 파라미터로 전달될 수 있음)
    setTimeout(() => {
      if (!tokenFound) {
        console.log('Continuing without captured token...');
        resolve();
      }
    }, 10000);
  });
}

export default globalSetup;
