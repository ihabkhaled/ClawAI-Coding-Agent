import * as vscode from 'vscode';

const INITIAL_FILES: readonly {
  path: string[];
  content: string;
}[] = [
  {
    path: ['rules.md'],
    content:
      '# Project rules\n\n- Describe the non-negotiable architecture and coding rules for this repository.\n',
  },
  {
    path: ['architecture.md'],
    content: '# Architecture\n\nDescribe the system boundaries and dependency direction.\n',
  },
  {
    path: ['memory.md'],
    content:
      '# Project memory\n\nRecord durable, non-secret lessons that future ClawAI sessions should know.\n',
  },
  {
    path: ['context', 'product.md'],
    content: '# Product context\n\nDescribe users, goals, terminology, and important non-goals.\n',
  },
  {
    path: ['context', 'api.md'],
    content: '# API context\n\nDescribe API conventions and compatibility requirements.\n',
  },
  {
    path: ['context', 'database.md'],
    content: '# Database context\n\nDescribe ownership, migrations, and data safety rules.\n',
  },
  {
    path: ['context', 'testing.md'],
    content: '# Testing context\n\nDescribe required test lanes and quality gates.\n',
  },
  {
    path: ['skills', 'typescript.md'],
    content: '# TypeScript skill\n\nDescribe repository-specific TypeScript conventions.\n',
  },
  {
    path: ['skills', 'react.md'],
    content:
      '# React skill\n\nDescribe component, state, accessibility, and testing conventions.\n',
  },
  {
    path: ['skills', 'node.md'],
    content:
      '# Node.js skill\n\nDescribe runtime, security, dependency, and observability conventions.\n',
  },
  {
    path: ['skills', 'nestjs.md'],
    content:
      '# NestJS skill\n\nDescribe module boundaries, validation, authorization, and repository conventions.\n',
  },
  {
    path: ['prompts', 'code-review.md'],
    content: '# Code review prompt\n\nReview correctness, security, tests, and maintainability.\n',
  },
  {
    path: ['prompts', 'implementation-plan.md'],
    content:
      '# Implementation plan prompt\n\nPlan from verified repository facts and list deviations.\n',
  },
  {
    path: ['ignore'],
    content:
      '# One glob per line. Secret patterns are always excluded even if removed here.\n**/.git/**\n**/node_modules/**\n**/dist/**\n**/coverage/**\n**/.env*\n**/*secret*\n**/*credential*\n',
  },
];

export class ClawaiInitializer {
  async initialize(): Promise<number> {
    if (!vscode.workspace.isTrusted) {
      throw new Error(vscode.l10n.t('Trust this workspace before creating .clawai files.'));
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      throw new Error(vscode.l10n.t('Open a workspace before creating .clawai files.'));
    }

    let created = 0;
    for (const file of INITIAL_FILES) {
      const uri = vscode.Uri.joinPath(folder.uri, '.clawai', ...file.path);
      if (await this.exists(uri)) {
        continue;
      }
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(folder.uri, '.clawai', ...file.path.slice(0, -1)),
      );
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(file.content));
      created += 1;
    }
    return created;
  }

  private async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return false;
      }
      throw error;
    }
  }
}
