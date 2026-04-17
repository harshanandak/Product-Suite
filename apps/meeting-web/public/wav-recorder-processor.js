class WavRecorderProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const inputChannel = inputs[0]?.[0];
    const outputChannel = outputs[0]?.[0];

    if (!inputChannel) {
      return true;
    }

    const frame = new Float32Array(inputChannel.length);
    frame.set(inputChannel);
    this.port.postMessage({ samples: frame.buffer }, [frame.buffer]);

    if (outputChannel) {
      outputChannel.set(inputChannel);
    }

    return true;
  }
}

registerProcessor("wav-recorder-processor", WavRecorderProcessor);
