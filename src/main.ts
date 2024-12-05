import { Player } from "./player.ts";
import { Recorder } from "./recorder.ts";
import "./style.css";
import { LowLevelRTClient, SessionUpdateMessage, Voice } from "rt-client";




let realtimeStreaming: LowLevelRTClient;
let audioRecorder: Recorder;
let audioPlayer: Player;
let latencyStartTime: number | null = null;

const DEFAULT_ENDPOINT = "https://jarvi-m45ecr24-eastus2.cognitiveservices.azure.com/openai/realtime?api-version=2024-10-01-preview&deployment=gpt-4o-realtime-preview";
const DEFAULT_API_KEY = "3EPC6QLDw0DgCLbgf0n1255FZTldYiklBL3EnRT4EyFoC3IILCJ9JQQJ99ALACHYHv6XJ3w3AAAAACOG5Vc1";
const DEFAULT_DEPLOYMENT = "gpt-4o-realtime-preview";


const latencyDisplay = document.createElement('div');
latencyDisplay.id = 'latency-display';
latencyDisplay.textContent = 'Latency: -- ms';
latencyDisplay.style.fontWeight = 'bold';
latencyDisplay.style.marginBottom = '1rem';
latencyDisplay.style.color = '#444df5';

// Automatically populate form fields with default values
function populateDefaultFields() {
  formEndpointField.value = DEFAULT_ENDPOINT;
  formApiKeyField.value = DEFAULT_API_KEY;
  formDeploymentOrModelField.value = DEFAULT_DEPLOYMENT;
  
  // Since it's an Azure endpoint, check the Azure toggle
  formAzureToggle.checked = true;
}

async function start_realtime(endpoint: string, apiKey: string, deploymentOrModel: string) {
  if (isAzureOpenAI()) {
    realtimeStreaming = new LowLevelRTClient(new URL(endpoint), { key: apiKey }, { deployment: deploymentOrModel });
  } else {
    realtimeStreaming = new LowLevelRTClient({ key: apiKey }, { model: deploymentOrModel });
  }

  try {
    console.log("sending session config");
    await realtimeStreaming.send(createConfigMessage());
  } catch (error) {
    console.log(error);
    makeNewTextBlock("[Connection error]: Unable to send initial config message. Please check your endpoint and authentication details.");
    setFormInputState(InputState.ReadyToStart);
    return;
  }
  
  console.log("Configuration sent successfully");
  await Promise.all([resetAudio(true), handleRealtimeMessages()]);
}

function createConfigMessage(): SessionUpdateMessage {
  let configMessage : SessionUpdateMessage = {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
      },
      input_audio_transcription: {
        model: "whisper-1"
      }
    }
  };

  const systemMessage = getSystemMessage();
  const temperature = getTemperature();
  const voice = getVoice();

  if (systemMessage) {
    configMessage.session.instructions = systemMessage;
  }
  if (!isNaN(temperature)) {
    configMessage.session.temperature = temperature;
  }
  if (voice) {
    configMessage.session.voice = voice;
  }

  return configMessage;
}

async function handleRealtimeMessages() {
  for await (const message of realtimeStreaming.messages()) {
    let consoleLog = "" + message.type;
    switch (message.type) {
      case "session.created":
        setFormInputState(InputState.ReadyToStop);
        makeNewTextBlock("<< Session Started >>");
        makeNewTextBlock();
        break;
      case "response.audio_transcript.delta":
        if (latencyStartTime !== null) {
          const latency = performance.now() - latencyStartTime;
          updateLatencyDisplay(latency);
          latencyStartTime = null;
        }
        appendToTextBlock(message.delta);
        break;
      case "response.audio.delta":
        if (latencyStartTime !== null) {
          const latency = performance.now() - latencyStartTime;
          updateLatencyDisplay(latency);
          latencyStartTime = null;
        }
        const binary = atob(message.delta);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const pcmData = new Int16Array(bytes.buffer);
        audioPlayer.play(pcmData);
        break;
      case "input_audio_buffer.speech_started":
        makeNewTextBlock("<< Speech Started >>");
        let textElements = formReceivedTextContainer.children;
        latestInputSpeechBlock = textElements[textElements.length - 1];
        makeNewTextBlock();
        audioPlayer.clear();
        break;
      case "conversation.item.input_audio_transcription.completed":
        latestInputSpeechBlock.textContent += " User: " + message.transcript;
        latencyStartTime = performance.now();
        break;
      case "response.done":
        formReceivedTextContainer.appendChild(document.createElement("hr"));
        break;
      default:
        consoleLog = JSON.stringify(message, null, 2);
        break;
    }
    if (consoleLog) {
      console.log(consoleLog);
    }
  }
  resetAudio(false);
}

function updateLatencyDisplay(latency: number) {
  latencyDisplay.textContent = `Latency: ${latency.toFixed(2)} ms`;
}

// ... (rest of the code remains unchanged)

// Add this at the end of the file
const controlsDiv = document.querySelector('.controls');
if (controlsDiv) {
  controlsDiv.insertBefore(latencyDisplay, controlsDiv.firstChild);
}







/**
 * Basic audio handling
 */

let recordingActive: boolean = false;
let buffer: Uint8Array = new Uint8Array();

function combineArray(newData: Uint8Array) {
  const newBuffer = new Uint8Array(buffer.length + newData.length);
  newBuffer.set(buffer);
  newBuffer.set(newData, buffer.length);
  buffer = newBuffer;
}

function processAudioRecordingBuffer(data: Buffer) {
  const uint8Array = new Uint8Array(data);
  combineArray(uint8Array);
  if (buffer.length >= 4800) {
    const toSend = new Uint8Array(buffer.slice(0, 4800));
    buffer = new Uint8Array(buffer.slice(4800));
    const regularArray = String.fromCharCode(...toSend);
    const base64 = btoa(regularArray);
    if (recordingActive) {
      realtimeStreaming.send({
        type: "input_audio_buffer.append",
        audio: base64,
      });
    }
  }

}

async function resetAudio(startRecording: boolean) {
  recordingActive = false;
  if (audioRecorder) {
    audioRecorder.stop();
  }
  if (audioPlayer) {
    audioPlayer.clear();
  }
  audioRecorder = new Recorder(processAudioRecordingBuffer);
  audioPlayer = new Player();
  audioPlayer.init(24000);
  if (startRecording) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorder.start(stream);
    recordingActive = true;
  }
}

/**
 * UI and controls
 */

const formReceivedTextContainer = document.querySelector<HTMLDivElement>(
  "#received-text-container",
)!;
const formStartButton =
  document.querySelector<HTMLButtonElement>("#start-recording")!;
const formStopButton =
  document.querySelector<HTMLButtonElement>("#stop-recording")!;
const formClearAllButton =
  document.querySelector<HTMLButtonElement>("#clear-all")!;
const formEndpointField =
  document.querySelector<HTMLInputElement>("#endpoint")!;
const formAzureToggle =
  document.querySelector<HTMLInputElement>("#azure-toggle")!;
const formApiKeyField = document.querySelector<HTMLInputElement>("#api-key")!;
const formDeploymentOrModelField = document.querySelector<HTMLInputElement>("#deployment-or-model")!;
const formSessionInstructionsField =
  document.querySelector<HTMLTextAreaElement>("#session-instructions")!;
const formTemperatureField = document.querySelector<HTMLInputElement>("#temperature")!;
const formVoiceSelection = document.querySelector<HTMLInputElement>("#voice")!;

let latestInputSpeechBlock: Element;

enum InputState {
  Working,
  ReadyToStart,
  ReadyToStop,
}

function isAzureOpenAI(): boolean {
  return formAzureToggle.checked;
}

function guessIfIsAzureOpenAI() {
  const endpoint = (formEndpointField.value || "").trim();
  formAzureToggle.checked = endpoint.indexOf('azure') > -1;
}

function setFormInputState(state: InputState) {
  formEndpointField.disabled = state != InputState.ReadyToStart;
  formApiKeyField.disabled = state != InputState.ReadyToStart;
  formDeploymentOrModelField.disabled = state != InputState.ReadyToStart;
  formStartButton.disabled = state != InputState.ReadyToStart;
  formStopButton.disabled = state != InputState.ReadyToStop;
  formSessionInstructionsField.disabled = state != InputState.ReadyToStart;
  formAzureToggle.disabled = state != InputState.ReadyToStart;
}

function getSystemMessage(): string {
  return formSessionInstructionsField.value || "";
}

function getTemperature(): number {
  return parseFloat(formTemperatureField.value);
}

function getVoice(): Voice {
  return formVoiceSelection.value as Voice;
}

function makeNewTextBlock(text: string = "") {
  let newElement = document.createElement("p");
  newElement.textContent = text;
  formReceivedTextContainer.appendChild(newElement);
}

function appendToTextBlock(text: string) {
  let textElements = formReceivedTextContainer.children;
  if (textElements.length == 0) {
    makeNewTextBlock();
  }
  textElements[textElements.length - 1].textContent += text;
}

formStartButton.addEventListener("click", async () => {
  setFormInputState(InputState.Working);
  
  const endpoint = formEndpointField.value.trim() || DEFAULT_ENDPOINT;
  const key = formApiKeyField.value.trim() || DEFAULT_API_KEY;
  const deploymentOrModel = formDeploymentOrModelField.value.trim() || DEFAULT_DEPLOYMENT;

  if (isAzureOpenAI() && !endpoint && !deploymentOrModel) {
      alert("Endpoint and Deployment are required for Azure OpenAI");
      return;
  }
  
  if (!isAzureOpenAI() && !deploymentOrModel) {
      alert("Model is required for OpenAI");
      return;
  }
  
  if (!key) {
      alert("API Key is required");
      return;
  }

  try {
      start_realtime(endpoint, key, deploymentOrModel);
  } catch (error) {
      console.log(error);
      setFormInputState(InputState.ReadyToStart);
  }
});

// Populate default fields when the page loads
document.addEventListener('DOMContentLoaded', populateDefaultFields);



// Populate default fields when the page loads
document.addEventListener('DOMContentLoaded', populateDefaultFields);

formStopButton.addEventListener("click", async () => {
  setFormInputState(InputState.Working);
  resetAudio(false);
  realtimeStreaming.close();
  setFormInputState(InputState.ReadyToStart);
});

formClearAllButton.addEventListener("click", async () => {
  formReceivedTextContainer.innerHTML = "";
});

formEndpointField.addEventListener('change', async () => {
  guessIfIsAzureOpenAI();
});
guessIfIsAzureOpenAI();

