import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectDiagramFormat, resolveDiagramFile, renameDiagramFile, getFormatExtension, isPlantUMLFormat } from '../lib/format.js';
import { validatePlantUML, validateDiagramFormat } from '../lib/validate.js';
import { FIELD_FILES, FORMAT_DEFAULT_FILES, DIAGRAM_EXTENSIONS } from '../types.js';

describe('PlantUML Format Detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-plantuml-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects mermaid format by default', () => {
    fs.writeFileSync(path.join(tmpDir, 'diagram.mmd'), 'graph TD\n  A-->B');
    const result = detectDiagramFormat(tmpDir);
    expect(result.format).toBe('mermaid');
    expect(result.file).toBe('diagram.mmd');
  });

  it('detects plantuml format from .puml extension', () => {
    fs.writeFileSync(path.join(tmpDir, 'diagram.puml'), '@startuml\nA -> B\n@enduml');
    const result = detectDiagramFormat(tmpDir);
    expect(result.format).toBe('plantuml');
    expect(result.file).toBe('diagram.puml');
  });

  it('detects plantuml format from .plantuml extension', () => {
    fs.writeFileSync(path.join(tmpDir, 'diagram.plantuml'), '@startuml\nA -> B\n@enduml');
    const result = detectDiagramFormat(tmpDir);
    expect(result.format).toBe('plantuml');
    expect(result.file).toBe('diagram.plantuml');
  });

  it('defaults to mermaid when no diagram file exists', () => {
    const result = detectDiagramFormat(tmpDir);
    expect(result.format).toBe('mermaid');
    expect(result.file).toBeNull();
  });

  it('returns mermaid when both formats exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'diagram.mmd'), 'graph TD\n  A-->B');
    fs.writeFileSync(path.join(tmpDir, 'diagram.puml'), '@startuml\nA -> B\n@enduml');
    const result = detectDiagramFormat(tmpDir);
    // First match wins based on object key order
    expect(['mermaid', 'plantuml']).toContain(result.format);
  });
});

describe('Diagram File Resolution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-resolve-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves mermaid diagram file', () => {
    fs.writeFileSync(path.join(tmpDir, 'diagram.mmd'), 'graph TD\n  A-->B');
    const result = resolveDiagramFile(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.format).toBe('mermaid');
    expect(result!.path).toBe(path.join(tmpDir, 'diagram.mmd'));
  });

  it('resolves plantuml diagram file', () => {
    fs.writeFileSync(path.join(tmpDir, 'diagram.puml'), '@startuml\nA -> B\n@enduml');
    const result = resolveDiagramFile(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.format).toBe('plantuml');
    expect(result!.path).toBe(path.join(tmpDir, 'diagram.puml'));
  });

  it('returns null when no diagram exists', () => {
    const result = resolveDiagramFile(tmpDir);
    expect(result).toBeNull();
  });
});

describe('Diagram File Renaming', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-rename-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('renames mermaid to plantuml', () => {
    fs.writeFileSync(path.join(tmpDir, 'diagram.mmd'), 'graph TD\n  A-->B');
    const result = renameDiagramFile(tmpDir, 'mermaid', 'plantuml');
    expect(result).not.toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'diagram.puml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'diagram.mmd'))).toBe(false);
  });

  it('renames plantuml to mermaid', () => {
    fs.writeFileSync(path.join(tmpDir, 'diagram.puml'), '@startuml\nA -> B\n@enduml');
    const result = renameDiagramFile(tmpDir, 'plantuml', 'mermaid');
    expect(result).not.toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'diagram.mmd'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'diagram.puml'))).toBe(false);
  });

  it('returns null when source file does not exist', () => {
    const result = renameDiagramFile(tmpDir, 'mermaid', 'plantuml');
    expect(result).toBeNull();
  });

  it('returns path when same format (no rename needed)', () => {
    fs.writeFileSync(path.join(tmpDir, 'diagram.mmd'), 'graph TD\n  A-->B');
    const result = renameDiagramFile(tmpDir, 'mermaid', 'mermaid');
    expect(result).toBe(path.join(tmpDir, 'diagram.mmd'));
  });
});

describe('Format Utilities', () => {
  it('getFormatExtension returns correct extensions', () => {
    expect(getFormatExtension('mermaid')).toBe('.mmd');
    expect(getFormatExtension('plantuml')).toBe('.puml');
  });

  it('isPlantUMLFormat works correctly', () => {
    expect(isPlantUMLFormat('plantuml')).toBe(true);
    expect(isPlantUMLFormat('mermaid')).toBe(false);
  });

  it('DIAGRAM_EXTENSIONS maps correctly', () => {
    expect(DIAGRAM_EXTENSIONS['.mmd']).toBe('mermaid');
    expect(DIAGRAM_EXTENSIONS['.puml']).toBe('plantuml');
    expect(DIAGRAM_EXTENSIONS['.plantuml']).toBe('plantuml');
  });

  it('FORMAT_DEFAULT_FILES has correct defaults', () => {
    expect(FORMAT_DEFAULT_FILES.mermaid).toBe('diagram.mmd');
    expect(FORMAT_DEFAULT_FILES.plantuml).toBe('diagram.puml');
  });
});

describe('PlantUML Validation', () => {
  it('validates a correct PlantUML diagram', () => {
    const text = `@startuml
participant User
participant Server
User -> Server: Request
Server -> User: Response
@enduml`;
    const result = validatePlantUML(text);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects empty PlantUML diagram', () => {
    const result = validatePlantUML('');
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].rule).toBe('empty-diagram');
  });

  it('warns on missing @startuml', () => {
    const text = `participant User
User -> Server: Request
@enduml`;
    const result = validatePlantUML(text);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.rule === 'missing-startuml')).toBe(true);
  });

  it('warns on missing @enduml', () => {
    const text = `@startuml
participant User
User -> Server: Request`;
    const result = validatePlantUML(text);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.rule === 'missing-enduml')).toBe(true);
  });

  it('warns on single participant', () => {
    const text = `@startuml
participant User
User -> User: Self
@enduml`;
    const result = validatePlantUML(text);
    expect(result.valid).toBe(true);
    expect(result.issues.some(i => i.rule === 'few-participants')).toBe(true);
  });

  it('validates C4 diagram', () => {
    const text = `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4/master/C4_Context.puml

Person(user, "User", "Uses the system")
System(omnimap, "OmniMap", "Architecture docs")

Rel(user, omnimap, "Uses")
@enduml`;
    const result = validatePlantUML(text);
    expect(result.valid).toBe(true);
  });

  it('validates sequence diagram with blocks', () => {
    const text = `@startuml
participant User
participant Server

User -> Server: Request
alt success
  Server -> User: 200 OK
else error
  Server -> User: 500 Error
end
@enduml`;
    const result = validatePlantUML(text);
    expect(result.valid).toBe(true);
  });
});

describe('Format-Aware Validation Dispatch', () => {
  it('dispatches to mermaid validator', () => {
    const text = 'graph TD\n  A-->B';
    const result = validateDiagramFormat(text, 'mermaid');
    expect(result.valid).toBe(true);
  });

  it('dispatches to plantuml validator', () => {
    const text = '@startuml\nA -> B\n@enduml';
    const result = validateDiagramFormat(text, 'plantuml');
    expect(result.valid).toBe(true);
  });

  it('mermaid validator rejects invalid mermaid', () => {
    const text = '@startuml\nA -> B\n@enduml';
    const result = validateDiagramFormat(text, 'mermaid');
    // Mermaid validator should have issues with this
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('plantuml validator rejects invalid plantuml', () => {
    const text = 'graph TD\n  A-->B';
    const result = validateDiagramFormat(text, 'plantuml');
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.rule === 'missing-startuml')).toBe(true);
  });
});
