// A single Level.
// Usually levels are being extracted from AecModelData - but can be generated from other sources (artificially created from viewports).
export default class Level {
    constructor(index, guid, name, zMin, zMax, isArtificialLevel) {
        this.index = index;
        this.name = name;
        this.zMin = zMin;
        this.zMax = zMax;
        this.guid = guid;
        this.isArtificialLevel = isArtificialLevel; // Artificial level === Level that was generated from a viewport. Not from AecModelData.
    }
}
