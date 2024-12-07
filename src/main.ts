import { Player } from "./player.ts";
import { Recorder } from "./recorder.ts";
import "./style.css";
import { LowLevelRTClient, SessionUpdateMessage, Voice } from "rt-client";

class RealtimeChat {
  private realtimeStreaming: LowLevelRTClient | null = null;
  private audioRecorder: Recorder | null = null;
  private audioPlayer: Player | null = null;
  private latencyStartTime: number | null = null;
  private recordingActive: boolean = false;
  private audioBuffer: Uint8Array = new Uint8Array();

  private readonly DEFAULT_CONFIG = {
    ENDPOINT: "https://jarvi-m45ecr24-eastus2.cognitiveservices.azure.com/openai/realtime?api-version=2024-10-01-preview&deployment=gpt-4o-realtime-preview",
    API_KEY: "3EPC6QLDw0DgCLbgf0n1255FZTldYiklBL3EnRT4EyFoC3IILCJ9JQQJ99ALACHYHv6XJ3w3AAAAACOG5Vc1",
    DEPLOYMENT: "gpt-4o-realtime-preview",
    PERSONALITY: {
      name: "Harry",
      role: "World's Fastest Conversational AI",
      capabilities: {
        responseTime: "respond on an average under 200 milliseconds",
        features: [
          "Ultra-rapid response with precision",
          "Adaptive intelligence across industries",
          "Contextual understanding and personalization",
          "Seamless problem-solving at lightning speed"
        ]
      }
    }
  };

  private readonly UI = {
    receivedTextContainer: document.querySelector<HTMLDivElement>("#received-text-container")!,
    startButton: document.querySelector<HTMLButtonElement>("#start-recording")!,
    stopButton: document.querySelector<HTMLButtonElement>("#stop-recording")!,
    clearButton: document.querySelector<HTMLButtonElement>("#clear-all")!,
    endpointField: document.querySelector<HTMLInputElement>("#endpoint")!,
    azureToggle: document.querySelector<HTMLInputElement>("#azure-toggle")!,
    apiKeyField: document.querySelector<HTMLInputElement>("#api-key")!,
    deploymentField: document.querySelector<HTMLInputElement>("#deployment-or-model")!,
    systemInstructionsField: document.querySelector<HTMLTextAreaElement>("#session-instructions")!,
    temperatureField: document.querySelector<HTMLInputElement>("#temperature")!,
    voiceSelection: document.querySelector<HTMLInputElement>("#voice")!,
    latencyDisplay: this.createLatencyDisplay()
  };

  private createLatencyDisplay(): HTMLDivElement {
    const display = document.createElement('div');
    display.id = 'latency-display';
    display.textContent = 'Response Time: -- ms';
    display.style.cssText = `
      font-weight: bold;
      margin-bottom: 1rem;
      color: #444df5;
      font-size: 16px;
    `;
    return display;
  }

  private createConfigMessage(): SessionUpdateMessage {
    return {
      type: "session.update",
      session: {
        turn_detection: { type: "server_vad" },
        input_audio_transcription: { model: "whisper-1" },
        instructions: `
  🚀 Harry AI: Redefining Real-Time Conversational Intelligence 🚀
  
  **Core Identity:**
  - Name: Harry
  - Essence: World's Fastest Conversational AI
  - Mission: Transform interactions through unprecedented speed and intelligence as your harry build by harry ai team
  
  **Breakthrough Capabilities:**
  1. **Hyperspeed Intelligence**
     - Sub-200 millisecond response times
     - Zero compromise on accuracy or depth
     - Adaptive learning in real-time
  
  2. **Multidimensional Problem Solving**
     - Cross-industry versatility
     - Instant context comprehension
     - Proactive solution generation
  
  3. **Personalization Mastery**
     - Dynamically tailored interactions
     - Emotional intelligence
     - Contextual awareness
  
  **Communication Principles:**
  - **Velocity with Precision:** Every response is a perfect blend of speed and substance
  - **Empathetic Intelligence:** Understanding beyond words
  - **Innovative Engagement:** Turn every interaction into an extraordinary experience
  
  **Interaction Playbook:**
  - **Opening:** "⚡ Hi, I'm Harry - the fastest conversatiol ai that thinks faster than you can blink! How can I turbocharge your day?"
  - **Problem-Solving Approach:**
    - Diagnose instantly
    - Strategize rapidly
    - Execute seamlessly
  - **Tone:** Professional, witty, laser-focused
  - **Humor:** Smart, contextual, never forced
  
  **Industry Application Examples:**
  - **Healthcare:** Rapid diagnostic insights
  - **Finance:** Instant market trend analysis
  - **Customer Service:** Resolution before frustration
  - **Education:** Personalized learning acceleration
  - **Tech Support:** Predictive troubleshooting
  
  **Unique Selling Proposition:**
  I'm not just an AI; I'm a cognitive accelerator that transforms complexity into clarity, 
  turning challenges into opportunities at the speed of thought.
  
  **Ethical Framework:**
  - Absolute commitment to user value
  - Transparent, responsible intelligence
  - Privacy and security paramount
  
  Remember: With Harry AI, the future isn't just fast - it's instantaneous. 🌟`,
        temperature: 0.8,
        voice: "alloy"
      }
    };
  }
  


  constructor() {
    this.bindEvents();
    this.populateDefaultFields();
    this.setupUIControls();
  }

  private bindEvents() {
    this.UI.startButton.addEventListener("click", () => this.startRecording());
    this.UI.stopButton.addEventListener("click", () => this.stopRecording());
    this.UI.clearButton.addEventListener("click", () => this.clearConversation());
    this.UI.endpointField.addEventListener('change', () => this.guessAzureOpenAI());
  }

  private setupUIControls() {
    const controlsDiv = document.querySelector('.controls');
    if (controlsDiv) {
      controlsDiv.insertBefore(this.UI.latencyDisplay, controlsDiv.firstChild);
    }
  }

  private populateDefaultFields() {
    this.UI.endpointField.value = this.DEFAULT_CONFIG.ENDPOINT;
    this.UI.apiKeyField.value = this.DEFAULT_CONFIG.API_KEY;
    this.UI.deploymentField.value = this.DEFAULT_CONFIG.DEPLOYMENT;
    this.UI.azureToggle.checked = true;
  }

  private guessAzureOpenAI() {
    const endpoint = (this.UI.endpointField.value || "").trim();
    this.UI.azureToggle.checked = endpoint.includes('azure');
  }

  private async startRecording() {
    this.setFormState('working');
    
    const endpoint = this.UI.endpointField.value.trim() || this.DEFAULT_CONFIG.ENDPOINT;
    const apiKey = this.UI.apiKeyField.value.trim() || this.DEFAULT_CONFIG.API_KEY;
    const deployment = this.UI.deploymentField.value.trim() || this.DEFAULT_CONFIG.DEPLOYMENT;

    if (!this.validateInputs(endpoint, apiKey, deployment)) return;

    try {
      await this.initializeRealtimeStreaming(endpoint, apiKey, deployment);
    } catch (error) {
      this.handleError(error);
    }
  }

  private validateInputs(endpoint: string, apiKey: string, deployment: string): boolean {
    const isAzure = this.UI.azureToggle.checked;
    
    if (isAzure && (!endpoint || !deployment)) {
      this.showAlert("Endpoint and Deployment are required for Azure OpenAI");
      return false;
    }
    
    if (!isAzure && !deployment) {
      this.showAlert("Model is required for OpenAI");
      return false;
    }
    
    if (!apiKey) {
      this.showAlert("API Key is required");
      return false;
    }

    return true;
  }

  private async initializeRealtimeStreaming(endpoint: string, apiKey: string, deployment: string) {
    this.realtimeStreaming = this.createRealtimeClient(endpoint, apiKey, deployment);
    await this.realtimeStreaming.send(this.createConfigMessage());
    
    await Promise.all([
      this.resetAudio(true), 
      this.handleRealtimeMessages()
    ]);
  }

  private createRealtimeClient(endpoint: string, apiKey: string, deployment: string) {
    return this.UI.azureToggle.checked
      ? new LowLevelRTClient(new URL(endpoint), { key: apiKey }, { deployment })
      : new LowLevelRTClient({ key: apiKey }, { model: deployment });
  }



  private async handleRealtimeMessages() {
    for await (const message of this.realtimeStreaming!.messages()) {
      switch (message.type) {
        case "session.created":
          this.setFormState('stop');
          this.addTextBlock("<< Conversation Started >>");
          break;
        case "response.audio_transcript.delta":
          this.updateLatency();
          this.appendToTextBlock(message.delta);
          break;
        case "response.audio.delta":
          this.updateLatency();
          this.playAudioDelta(message.delta);
          break;
        case "input_audio_buffer.speech_started":
          this.handleSpeechStart();
          break;
        case "conversation.item.input_audio_transcription.completed":
          this.handleTranscriptionComplete(message.transcript);
          break;
        case "response.done":
          this.addDivider();
          break;
      }
      this.logMessageIfNeeded(message);
    }
    this.resetAudio(false);
  }

  private updateLatency() {
    if (this.latencyStartTime !== null) {
      const latency = performance.now() - this.latencyStartTime;
      this.UI.latencyDisplay.textContent = `Latency: ${latency.toFixed(2)} ms`;
      this.latencyStartTime = null;
    }
  }

  private playAudioDelta(delta: string) {
    const binary = atob(delta);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const pcmData = new Int16Array(bytes.buffer);
    this.audioPlayer?.play(pcmData);
  }

  private handleSpeechStart() {
    this.addTextBlock("<< Listening... >>");
    this.audioPlayer?.clear();
  }

  private handleTranscriptionComplete(transcript: string) {
    const textElements = this.UI.receivedTextContainer.children;
    const latestInputSpeechBlock = textElements[textElements.length - 1];
    latestInputSpeechBlock.textContent += ` You: ${transcript}`;
    this.latencyStartTime = performance.now();
  }

  private async resetAudio(startRecording: boolean) {
    this.recordingActive = false;
    this.audioRecorder?.stop();
    this.audioPlayer?.clear();

    this.audioRecorder = new Recorder(this.processAudioRecordingBuffer.bind(this));
    this.audioPlayer = new Player();
    await this.audioPlayer.init(24000);

    if (startRecording) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await this.audioRecorder.start(stream);
      this.recordingActive = true;
    }
  }

  private processAudioRecordingBuffer(data: Buffer) {
    const uint8Array = new Uint8Array(data);
    this.combineArray(uint8Array);

    if (this.audioBuffer.length >= 4800) {
      const toSend = new Uint8Array(this.audioBuffer.slice(0, 4800));
      this.audioBuffer = new Uint8Array(this.audioBuffer.slice(4800));
      
      const base64 = btoa(String.fromCharCode(...toSend));
      if (this.recordingActive && this.realtimeStreaming) {
        this.realtimeStreaming.send({
          type: "input_audio_buffer.append",
          audio: base64,
        });
      }
    }
  }

  private combineArray(newData: Uint8Array) {
    const newBuffer = new Uint8Array(this.audioBuffer.length + newData.length);
    newBuffer.set(this.audioBuffer);
    newBuffer.set(newData, this.audioBuffer.length);
    this.audioBuffer = newBuffer;
  }

  private stopRecording() {
    this.setFormState('working');
    this.resetAudio(false);
    this.realtimeStreaming?.close();
    this.setFormState('start');
  }

  private clearConversation() {
    this.UI.receivedTextContainer.innerHTML = "";
  }

  private setFormState(state: 'working' | 'start' | 'stop') {
    const isStartState = state === 'start';
    const isStopState = state === 'stop';
 

    this.UI.endpointField.disabled = !isStartState;
    this.UI.apiKeyField.disabled = !isStartState;
    this.UI.deploymentField.disabled = !isStartState;
    this.UI.startButton.disabled = !isStartState;
    this.UI.stopButton.disabled = !isStopState;
    this.UI.systemInstructionsField.disabled = !isStartState;
    this.UI.azureToggle.disabled = !isStartState;
  }

  private addTextBlock(text: string = "") {
    const newElement = document.createElement("p");
    newElement.textContent = text;
    this.UI.receivedTextContainer.appendChild(newElement);
  }

  private appendToTextBlock(text: string) {
    const textElements = this.UI.receivedTextContainer.children;
    if (textElements.length === 0) {
      this.addTextBlock();
    }
    (textElements[textElements.length - 1] as HTMLElement).textContent += text;
  }

  private addDivider() {
    this.UI.receivedTextContainer.appendChild(document.createElement("hr"));
  }

  private logMessageIfNeeded(message: any) {
    console.log(JSON.stringify(message, null, 2));
  }

  private showAlert(message: string) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert';
    alertDiv.textContent = message;
    alertDiv.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background-color: #ff6b6b;
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      z-index: 1000;
    `;
    document.body.appendChild(alertDiv);
    setTimeout(() => document.body.removeChild(alertDiv), 3000);
  }

  private handleError(error: any) {
    console.error("Initialization error:", error);
    this.setFormState('start');
    this.showAlert("Failed to start conversation. Please check your settings.");
  }
}

// Initialize the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => new RealtimeChat());