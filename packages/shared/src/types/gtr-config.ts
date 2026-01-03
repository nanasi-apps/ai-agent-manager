export interface GtrConfig {
	copy: {
		include: string[];
		exclude: string[];
		includeDirs: string[];
		excludeDirs: string[];
	};
	hooks: {
		postCreate: string[];
	};
}
