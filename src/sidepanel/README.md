# AI Assistant Sidepanel

A comprehensive sidepanel interface for your Chrome extension AI assistant with multiple AI-powered features.

## Features

### 🎯 Initial Setup Wizard

On first use, users go through a comprehensive setup wizard that includes:

1. **Welcome Screen** - Introduction to the AI assistant
2. **User Name** - Personalize the experience
3. **Mascot Selection** - Choose from Yellow, Blue, or Pink mascots
4. **AI Persona** - Optional: Define custom personality for the AI
5. **Permissions** - Grant microphone and notification access
6. **Model Downloads** - Download all required AI models with progress tracking
7. **Voice Settings** - Select voice engine (Kokoro/Browser) and test voices
8. **Completion** - Friendly greeting and transition to main interface

### 💬 Chat Tab (Main)

- Real-time AI chat interface using Ant Design X components
- Streaming responses for better UX
- Message history with user/assistant distinction
- Export chat history as JSON
- Clear conversation functionality
- Respects user's persona settings

### 🎯 Prompt Tab

Direct access to the Language Model with:
- Custom user prompts
- Optional system prompt
- Advanced settings (collapsible):
  - TopK parameter
  - Temperature control
  - Max Quota Usage
- Real-time streaming responses
- Response card display

### 📄 Summarizer Tab

Powerful text summarization with:
- Text input with context support
- Summary type selection (TLDR, Key Points, Teaser, Headline)
- Length options (Short, Medium, Long)
- Format options (Plain Text, Markdown)
- Advanced settings:
  - Large Content Strategy (Merge/Join)
  - Handles text larger than context window

### ✍️ Writer Tab

Generate text from descriptions:
- Description input
- Tone selection (Formal, Neutral, Casual)
- Length options
- Format options
- Large content strategy support

### 🔄 Rewriter Tab

Rewrite text with different styles:
- Text input for rewriting
- Shared context field
- Specific rewrite instructions
- Tone adjustment (As-is, More Formal, More Casual)
- Length adjustment (As-is, Shorter, Longer)
- Format options
- Large content strategy

### 🌐 Translator Tab

Translate between languages:
- Text input
- Source language selection with auto-detect
- Target language selection
- Auto-detect button for language detection
- 20+ supported languages
- Clean, intuitive interface

### ⚙️ Settings Tab

Comprehensive settings management:

#### User Identity
- User name customization

#### Visual Preferences
- Mascot selection (affects all app mascots)
- Interactive selection with previews

#### AI Persona
- Define custom AI personality
- Character count (max 500)

#### Speech Settings
- Engine selection (Kokoro/Browser)
- Voice selection based on engine
- Speech rate slider
- Speech pitch slider
- Speech volume slider

#### Notifications
- Enable/disable notifications
- Voice alerts toggle
- Notification sound toggle

#### AI Action Settings
- Default summarizer type
- Default summarizer length
- Large content strategy
- Translation target language
- Explain prompt customization

#### Assistant Control
- Enable/disable assistant globally

**Actions:**
- Save all settings
- Reset to defaults

## Technical Details

### Structure

```
src/sidepanel/
├── index.tsx                 # Main sidepanel component with tab navigation
├── index.module.css
└── components/
    ├── InitialSetup.tsx      # Setup wizard
    ├── InitialSetup.module.css
    ├── ChatTab.tsx           # AI chat interface
    ├── ChatTab.module.css
    ├── PromptTab.tsx         # Direct LLM prompting
    ├── PromptTab.module.css
    ├── SummarizerTab.tsx     # Text summarization
    ├── SummarizerTab.module.css
    ├── WriterTab.tsx         # Text generation
    ├── WriterTab.module.css
    ├── RewriterTab.tsx       # Text rewriting
    ├── RewriterTab.module.css
    ├── TranslatorTab.tsx     # Language translation
    ├── TranslatorTab.module.css
    ├── SettingsTab.tsx       # Comprehensive settings
    └── SettingsTab.module.css
```

### State Management

- Uses `UserPreferences` singleton for persistent storage via IndexedDB
- Settings automatically saved and loaded
- Setup completion tracking

### UI Components

- Built with Ant Design and Ant Design X
- Responsive layout optimized for sidepanel width
- Dark/Light theme support (follows app theme)
- CSS Modules for scoped styling
- Accessible and keyboard-friendly

### AI Integration

- Uses custom Ex classes (LanguageModelEx, SummarizerEx, etc.)
- Streaming support for real-time responses
- Error handling with user-friendly messages
- Loading states for all async operations

## Usage

The sidepanel is accessible via the extension's sidepanel action. On first launch, users will see the setup wizard. After setup, the main interface with tabs becomes available.

### Navigation

- **Tabs** at the top for quick feature access
- **Settings** tab always available for customization
- All preferences persist across sessions

### Best Practices

1. Complete the setup wizard for optimal experience
2. Set a persona for consistent AI responses
3. Configure voice settings before using voice features
4. Export important chat conversations
5. Adjust AI settings in the Settings tab based on needs

## Development

### Adding New Features

1. Create new component in `components/`
2. Add corresponding CSS module
3. Import in main `index.tsx`
4. Add new tab item to `tabItems` array
5. Update TypeScript `TabKey` type

### Styling

- Use CSS modules for component styles
- Follow existing naming conventions
- Respect Ant Design theme variables
- Test in both light and dark modes

### Testing

- Test all tabs individually
- Verify setup wizard flow
- Check settings persistence
- Test error states
- Validate streaming responses
